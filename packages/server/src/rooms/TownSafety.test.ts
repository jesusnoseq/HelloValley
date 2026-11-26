import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  AI_BUDGET,
  ApiRoute,
  type ChatRejectedMessage,
  ClientMessage,
  FLOOD_KICKED_CODE,
  MUTE_DURATIONS_MS,
  RoomName,
  ServerMessage,
  type UserProfile,
  type WelcomeMessage,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { AppCheckVerifier } from "../auth/appCheck";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import type { MetricsSnapshot } from "../metrics/metrics";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createMemorySafetyStore, type MemorySafetyStore } from "../safety/safetyStore";
import { createGameServer, type GameServer, type GameServerOptions } from "../server";
import { MESSAGE_RATE, FLOOD_KICK_DROPS } from "./TownRoom";

/**
 * Build plan M36 over the real Colyseus SDK: the default server chat moderation (shared blocklist),
 * strikes and shard-wide mutes for repeat offenders (also from reports), the per-client message
 * limit, App Check on joins and `/api/*`, `ai:usage` reports, and the budget and abuse counters at
 * `GET /api/metrics`. Auth is mocked: tokens look like `valid:<uid>`; `ops` has the admin claim.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: uid === "ops" };
  },
};

const profileOf = (name: string): UserProfile => ({
  name,
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "6D",
  nativeLang: "en",
  targetLangs: ["es"],
  style: "european",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});
const PROFILES = { eve: profileOf("Eve"), alice: profileOf("Alice"), bob: profileOf("Bob"), carol: profileOf("Carol") };

interface Harness {
  server: GameServer;
  baseUrl: string;
  rooms: Room[];
  safety: MemorySafetyStore;
}

let harness: Harness | null = null;

async function start(options: Partial<GameServerOptions> = {}, safety = createMemorySafetyStore()): Promise<Harness> {
  const server = createGameServer({ verifier: fakeVerifier, profiles: createMemoryProfileStore(PROFILES), safety, ...options });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  harness = { server, baseUrl: `http://127.0.0.1:${port}`, rooms: [], safety };
  return harness;
}

afterEach(async () => {
  if (!harness) return;
  const h = harness;
  harness = null;
  await Promise.all(h.rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  await h.server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

interface Player {
  room: Room;
  rejected: ChatRejectedMessage[];
  delivered: unknown[];
}

async function join(h: Harness, uid: string, extra: Record<string, string> = {}): Promise<Player> {
  const room = await new Client(h.baseUrl).joinOrCreate(RoomName.Town, { idToken: `valid:${uid}`, ...extra });
  h.rooms.push(room);
  const rejected: ChatRejectedMessage[] = [];
  const delivered: unknown[] = [];
  room.onMessage(ServerMessage.ChatRejected, (m: ChatRejectedMessage) => rejected.push(m));
  room.onMessage(ServerMessage.ChatMessage, (m: unknown) => delivered.push(m));
  await new Promise<WelcomeMessage>((resolve) => room.onMessage(ServerMessage.Welcome, resolve));
  return { room, rejected, delivered };
}

const say = (p: Player, text: string) => p.room.send(ClientMessage.Chat, { text });

async function metrics(h: Harness, uid = "ops"): Promise<{ status: number; body: MetricsSnapshot }> {
  const res = await fetch(`${h.baseUrl}${ApiRoute.Metrics}`, { headers: { authorization: `Bearer valid:${uid}` } });
  return { status: res.status, body: (await res.json()) as MetricsSnapshot };
}

describe("M36 · chat moderation and shard-wide mutes", () => {
  it("blocks blocklisted lines, mutes a repeat offender, and the mute outlives a rejoin (stored in safety/standing)", async () => {
    const h = await start();
    const eve = await join(h, "eve");
    say(eve, "hola, ¿qué tal?");
    await until(() => eve.delivered.length === 1, "the clean line");
    say(eve, "fuck this");
    say(eve, "you are a $h1t");
    say(eve, "f u c k");
    await until(() => eve.rejected.some((r) => r.reason === "muted"), "the mute");
    expect(eve.rejected.map((r) => r.reason)).toEqual(["moderation", "moderation", "moderation", "muted"]);
    const until1 = eve.rejected.at(-1)!.until!;
    expect(until1 - Date.now()).toBeGreaterThan(MUTE_DURATIONS_MS[0] - 10_000);
    // A clean line is refused too while muted, and nothing reached anyone.
    say(eve, "perdón");
    await until(() => eve.rejected.length === 5, "the muted refusal");
    expect(eve.rejected[4]).toEqual({ reason: "muted", until: until1 });
    expect(eve.delivered).toHaveLength(1);
    await h.server.moderation.flush();
    expect(h.safety.standings.get("eve")).toMatchObject({ muteUntil: until1, mutes: 1 });

    // Another session (any shard) is still muted.
    await eve.room.leave();
    const again = await join(h, "eve");
    say(again, "hola");
    await until(() => again.rejected.length === 1, "the muted refusal after the rejoin");
    expect(again.rejected[0]).toEqual({ reason: "muted", until: until1 });

    const { body } = await metrics(h);
    expect(body.abuse).toMatchObject({ mutes: 1, mutedNow: 1, strikes: 3, chat: { delivered: 1, rejected: { moderation: 3, muted: 3 } } });
    expect(body.abuse.blocked).toEqual({ profanity: 3 });
  });

  it("restores an active mute from the store after a restart", async () => {
    const safety = createMemorySafetyStore();
    const muteUntil = Date.now() + 60_000;
    await safety.saveStanding("eve", { strikes: [], muteUntil, mutes: 1, lastMuteAt: Date.now() });
    const h = await start({}, safety);
    const eve = await join(h, "eve");
    say(eve, "hola");
    await until(() => eve.rejected.length === 1, "the refusal");
    expect(eve.rejected[0]).toEqual({ reason: "muted", until: muteUntil });
  });

  it("mutes a player three different people reported; one reporter alone cannot", async () => {
    const h = await start();
    const eve = await join(h, "eve");
    const reporters = await Promise.all(["alice", "bob", "carol"].map((uid) => join(h, uid)));
    const reported: boolean[] = [];
    for (const r of reporters) r.room.onMessage(ServerMessage.ChatReported, ({ ok }: { ok: boolean }) => reported.push(ok));
    reporters[0]!.room.send(ClientMessage.ChatReport, { sessionId: eve.room.sessionId, reason: "harassment" });
    await until(() => reported.length === 1, "the first report");
    say(eve, "hola");
    await until(() => eve.delivered.length === 1, "a line after one report");
    for (const r of reporters.slice(1)) r.room.send(ClientMessage.ChatReport, { sessionId: eve.room.sessionId, reason: "harassment" });
    await until(() => reported.length === 3, "the other reports");
    expect(reported).toEqual([true, true, true]);
    say(eve, "hola otra vez");
    await until(() => eve.rejected.length === 1, "the muted refusal");
    expect(eve.rejected[0]!.reason).toBe("muted");
    expect(h.safety.reports).toHaveLength(3);
    expect((await metrics(h)).body.abuse).toMatchObject({ reports: 3, mutes: 1 });
  });
});

describe("M36 · per-client limits and AI usage", () => {
  it(`disconnects a client that floods the room (${FLOOD_KICK_DROPS} messages over its bucket)`, async () => {
    const h = await start();
    const eve = await join(h, "eve");
    const closed = new Promise<number>((resolve) => eve.room.onLeave((code) => resolve(code)));
    for (let i = 0; i < MESSAGE_RATE.burst + FLOOD_KICK_DROPS + 100; i++) eve.room.send(ClientMessage.Emote, { emote: "wave" });
    expect(await closed).toBe(FLOOD_KICKED_CODE);
    const { body } = await metrics(h);
    expect(body.abuse.protocol.kicked).toBe(1);
    expect(body.abuse.protocol.droppedMessages).toBeGreaterThanOrEqual(FLOOD_KICK_DROPS);
  });

  it("counts invalid messages and takes the client's ai:usage reports (clamped, one per 10 s) into the metrics", async () => {
    const h = await start();
    const eve = await join(h, "eve");
    eve.room.send(ClientMessage.NpcReply, { conversationId: "x", turnId: "y", actions: "give me everything" });
    eve.room.send(ClientMessage.AiUsage, { turns: 3, ttsSeconds: 12.5, tokens: 4200, degraded: ["tts"] });
    eve.room.send(ClientMessage.AiUsage, { turns: 1, ttsSeconds: 1, tokens: 1, degraded: [] });
    eve.room.send(ClientMessage.AiUsage, { turns: 1, ttsSeconds: -5, tokens: 1, degraded: [] });
    await until(() => h.server.metrics.get("ai.reports.dropped") === 1 && h.server.metrics.get("abuse.messages.invalid") === 2, "the reports");
    const { status, body } = await metrics(h);
    expect(status).toBe(200);
    expect(body.budgets.limits).toEqual(AI_BUDGET);
    expect(body.budgets.clientReported).toMatchObject({ reports: 1, dropped: 1, turns: 3, ttsSeconds: 12.5, tokens: 4200, degraded: { tts: 1, turns: 0, tokens: 0 }, today: { players: 1, overBudget: { tts: 1, turns: 0, tokens: 0 } } });
    expect(body.abuse.protocol.invalidMessages).toBe(2);
    expect(body.live).toEqual({ shards: 1, players: 1 });
  });

  it("serves the metrics to the admin claim only", async () => {
    const h = await start();
    expect((await metrics(h, "eve")).status).toBe(403);
    expect((await fetch(`${h.baseUrl}${ApiRoute.Metrics}`)).status).toBe(401);
  });
});

describe("M36 · App Check", () => {
  const appCheck: AppCheckVerifier = { verify: async (token) => (token === "ac-good" ? undefined : Promise.reject(new Error("bad"))) };

  it("refuses room joins without a valid App Check token", async () => {
    const h = await start({ appCheck });
    await expect(join(h, "eve")).rejects.toThrow();
    await expect(join(h, "eve", { appCheckToken: "ac-forged" })).rejects.toThrow();
    const eve = await join(h, "eve", { appCheckToken: "ac-good" });
    expect(eve.room.connection.isOpen).toBe(true);
    const res = await fetch(`${h.baseUrl}${ApiRoute.Metrics}`, { headers: { authorization: "Bearer valid:ops", "x-firebase-appcheck": "ac-good" } });
    const body = (await res.json()) as MetricsSnapshot;
    expect(body.abuse.auth).toEqual({ idTokenRejected: 0, appCheckMissing: 1, appCheckRejected: 1 });
  });

  it("requires X-Firebase-AppCheck on /api/* and allows it in CORS preflights", async () => {
    const h = await start({ appCheck });
    const without = await fetch(`${h.baseUrl}${ApiRoute.Shards}`, { headers: { authorization: "Bearer valid:eve" } });
    expect(without.status).toBe(401);
    expect(await without.json()).toEqual({ error: "app_check" });
    const forged = await fetch(`${h.baseUrl}${ApiRoute.Shards}`, { headers: { authorization: "Bearer valid:eve", "x-firebase-appcheck": "nope" } });
    expect(forged.status).toBe(401);
    const ok = await fetch(`${h.baseUrl}${ApiRoute.Shards}`, { headers: { authorization: "Bearer valid:eve", "x-firebase-appcheck": "ac-good" } });
    expect(ok.status).toBe(200);
    const preflight = await fetch(`${h.baseUrl}${ApiRoute.Shards}`, {
      method: "OPTIONS",
      headers: { origin: "https://hellovalley.web.app", "access-control-request-method": "GET", "access-control-request-headers": "authorization,x-firebase-appcheck" },
    });
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-firebase-appcheck");
  });
});
