import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  type BlockedPlayer,
  buildingExitPoint,
  type ChatBroadcast,
  chatDisplayPlan,
  chatReaderOf,
  type ChatRejectedMessage,
  type ChatReportedMessage,
  type ChatSafetyMessage,
  ClientMessage,
  type IntercomListMessage,
  intercomInteractable,
  type MoveCorrectionMessage,
  PlayerController,
  type PlayerMoveMessage,
  RoomName,
  ServerMessage,
  spaceDoors,
  type UserProfile,
  type VisitStatusMessage,
  type WelcomeMessage,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import type { ChatModerator } from "../moderation/chat";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createMemorySafetyStore, type MemorySafetyStore } from "../safety/safetyStore";
import { createGameServer, type GameServer } from "../server";
import { TOWN_SPAWN } from "./TownRoom";

/**
 * Multi-client proximity chat tests (build plan M18) with the real Colyseus SDK in Node: delivery
 * within 12 m, the per-reader display rule for players with different target languages, the
 * mandatory server moderation check, rate limits, and server-enforced mute, block and report.
 * Auth is mocked: tokens look like `valid:<uid>`.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const profileOf = (name: string, nativeLang: string, targetLang: string): UserProfile => ({
  name,
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "6D",
  nativeLang,
  targetLangs: [targetLang],
  style: "japanese",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});

/** Alice speaks English and learns Japanese; Bob speaks Spanish and learns English; Carol learns French. */
const PROFILES = {
  alice: profileOf("Alice", "en", "ja"),
  bob: profileOf("Bob", "es", "en"),
  carol: profileOf("Carol", "en", "fr"),
};

interface Harness {
  server: GameServer;
  baseUrl: string;
  rooms: Room[];
  safety: MemorySafetyStore;
}

let harness: Harness | null = null;

async function start(options: { blocks?: Record<string, BlockedPlayer[]>; moderateChat?: ChatModerator } = {}): Promise<Harness> {
  const safety = createMemorySafetyStore(options.blocks);
  const server = createGameServer({
    verifier: fakeVerifier,
    profiles: createMemoryProfileStore(PROFILES),
    safety,
    ...(options.moderateChat ? { moderateChat: options.moderateChat } : {}),
  });
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

function inbox<T>(room: Room, type: string): T[] {
  const list: T[] = [];
  room.onMessage(type, (m: T) => list.push(m));
  return list;
}

interface Player {
  uid: keyof typeof PROFILES;
  room: Room;
  chat: ChatBroadcast[];
  rejected: ChatRejectedMessage[];
  safety: ChatSafetyMessage[];
  reported: ChatReportedMessage[];
  corrections: MoveCorrectionMessage[];
  intercom: IntercomListMessage[];
  status: VisitStatusMessage[];
}

async function join(h: Harness, uid: keyof typeof PROFILES): Promise<Player> {
  const room = await new Client(h.baseUrl).joinOrCreate(RoomName.Town, { idToken: `valid:${uid}` });
  h.rooms.push(room);
  const p: Player = {
    uid,
    room,
    chat: inbox(room, ServerMessage.ChatMessage),
    rejected: inbox(room, ServerMessage.ChatRejected),
    safety: inbox(room, ServerMessage.ChatSafety),
    reported: inbox(room, ServerMessage.ChatReported),
    corrections: inbox(room, ServerMessage.MoveCorrection),
    intercom: inbox(room, ServerMessage.IntercomList),
    status: inbox(room, ServerMessage.VisitStatus),
  };
  await new Promise<WelcomeMessage>((resolve) => room.onMessage(ServerMessage.Welcome, resolve));
  await until(() => p.safety.length > 0, `${uid}'s safety lists`);
  return p;
}

const say = (p: Player, text: string, lang?: string) => p.room.send(ClientMessage.Chat, lang ? { text, lang } : { text });
const lastSafety = (p: Player) => p.safety.at(-1)!;

/** A client-side walker that reports to the room like the game client does. */
class Walker {
  readonly controller = new PlayerController({ space: TOWN_SPAWN.space, pos: TOWN_SPAWN.pos, heading: TOWN_SPAWN.heading });
  seq = 0;
  constructor(readonly player: Player) {}

  report(): void {
    const { space, pos, heading, motion } = this.controller.state;
    const move: PlayerMoveMessage = { seq: ++this.seq, epoch: 0, space, x: pos[0], z: pos[1], heading, motion };
    this.player.room.send(ClientMessage.PlayerMove, move);
  }

  async walk(ms: number): Promise<void> {
    let last = performance.now();
    const end = last + ms;
    while (performance.now() < end) {
      await sleep(50);
      const now = performance.now();
      const door = this.controller.update((now - last) / 1000);
      last = now;
      if (door) {
        this.report();
        this.controller.completeTransition();
      }
      this.report();
    }
  }

  /** Click-to-move (running) until the path ends, `space` is reached or `done` holds. */
  async walkTo(target: [number, number], stop: { space?: string; done?: () => boolean } = {}): Promise<void> {
    this.controller.setInput([0, 0], true);
    expect(this.controller.clickTo(target)).toBe(true);
    for (let k = 0; k < 80; k++) {
      await this.walk(100);
      if (stop.space ? this.controller.state.space === stop.space : !this.controller.waypoints) break;
      if (stop.done?.()) break;
    }
    this.controller.setInput([0, 0]);
    await this.walk(100);
    expect(this.player.corrections).toEqual([]);
  }

  get pos(): [number, number] {
    return this.controller.state.pos;
  }
}

/** Walks a fresh player out of their apartment to the lobby intercom, in town. */
async function walkOut(p: Player): Promise<Walker> {
  const w = new Walker(p);
  await w.walkTo(spaceDoors("apartment")[0]!.centre, { space: "town" });
  expect(w.controller.state.space).toBe("town");
  await w.walkTo(intercomInteractable().spot);
  return w;
}

/** Waits long enough for a message that should not arrive to have arrived. */
const settle = () => sleep(250);

describe("TownRoom chat: proximity and languages", () => {
  it("delivers within 12 m to two players with different target languages, each reading their own", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    const carol = await join(h, "carol");
    const [, bobWalker] = await Promise.all([walkOut(alice), walkOut(bob)]);

    // Alice writes in her target language (Japanese).
    say(alice, "こんにちは！", "ja");
    await until(() => alice.chat.length === 1 && bob.chat.length === 1, "alice's line to reach both");
    const line = bob.chat[0]!;
    expect(line).toMatchObject({ from: alice.room.sessionId, name: "Alice", text: "こんにちは！", lang: "ja" });
    expect(alice.chat[0]).toEqual(line);
    // Each reader applies the shared display rule with their own languages.
    expect(chatDisplayPlan(line.lang, chatReaderOf(PROFILES.alice))).toEqual({ shownLang: "ja", translateTo: null, hover: null });
    expect(chatDisplayPlan(line.lang, chatReaderOf(PROFILES.bob))).toEqual({ shownLang: "en", translateTo: "en", hover: { translateTo: "es" } });

    // Bob writes without naming a language: the server tags it with his target language.
    say(bob, "Nice to meet you");
    await until(() => alice.chat.length === 2 && bob.chat.length === 2, "bob's line to reach both");
    expect(alice.chat[1]).toMatchObject({ from: bob.room.sessionId, lang: "en" });
    expect(chatDisplayPlan(alice.chat[1]!.lang, chatReaderOf(PROFILES.alice))).toMatchObject({ shownLang: "ja", translateTo: "ja", hover: { translateTo: null } });
    expect(chatDisplayPlan(bob.chat[1]!.lang, chatReaderOf(PROFILES.bob))).toMatchObject({ shownLang: "en", translateTo: null });
    // Every message has its own id (the client caches translations per id).
    expect(alice.chat[0]!.id).not.toBe(alice.chat[1]!.id);

    // Carol is still in her own apartment: another space, nothing reaches her.
    await settle();
    expect(carol.chat).toEqual([]);

    // Bob runs off towards the farm: beyond 12 m he no longer hears Alice, nor she him.
    const farm = buildingExitPoint("farm").pos;
    const far = () => Math.hypot(bobWalker.pos[0] - intercomInteractable().spot[0], bobWalker.pos[1] - intercomInteractable().spot[1]) > 13;
    await bobWalker.walkTo([farm[0], farm[1]], { done: far });
    expect(far()).toBe(true);
    say(alice, "まだいる？", "ja");
    say(bob, "Can you hear me?");
    await until(() => alice.chat.length === 3 && bob.chat.length === 3, "the senders' own echoes");
    await settle();
    expect(alice.chat.map((m) => m.from)).toEqual([alice.room.sessionId, bob.room.sessionId, alice.room.sessionId]);
    expect(bob.chat.map((m) => m.from)).toEqual([alice.room.sessionId, bob.room.sessionId, bob.room.sessionId]);
    expect(carol.chat).toEqual([]);
  }, 40_000);
});

describe("TownRoom chat: moderation and rate limits", () => {
  it("runs the mandatory server check before anything is delivered", async () => {
    const seen: string[] = [];
    const h = await start({
      moderateChat: (text, { uid, lang }) => {
        seen.push(`${uid}:${lang}:${text}`);
        return /badword/i.test(text) ? { ok: false, reason: "blocked" } : { ok: true };
      },
    });
    const alice = await join(h, "alice");
    say(alice, "this has a BADWORD in it", "en");
    await until(() => alice.rejected.length === 1, "the rejection");
    expect(alice.rejected[0]).toEqual({ reason: "moderation" });
    say(alice, "fine");
    await until(() => alice.chat.length === 1, "the clean line");
    expect(alice.chat[0]!.text).toBe("fine");
    expect(seen).toEqual(["alice:en:this has a BADWORD in it", "alice:ja:fine"]);
  });

  it("rate-limits bursts and drops invalid payloads", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    for (let k = 0; k < 7; k++) say(alice, `line ${k}`);
    alice.room.send(ClientMessage.Chat, { text: "x", lang: "not-a-language" });
    alice.room.send(ClientMessage.Chat, { text: "   " });
    await until(() => alice.chat.length + alice.rejected.length === 7, "answers to the burst");
    expect(alice.chat.map((m) => m.text)).toEqual(["line 0", "line 1", "line 2", "line 3", "line 4"]);
    expect(alice.rejected).toEqual([{ reason: "rate" }, { reason: "rate" }]);
    await settle();
    expect(alice.chat).toHaveLength(5);
  });
});

describe("TownRoom chat: mute, block and report", () => {
  it("enforces mute and block on the server, persists blocks and keeps blocked players apart", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    await Promise.all([walkOut(alice), walkOut(bob)]);
    const aliceId = alice.room.sessionId;
    const bobId = bob.room.sessionId;

    // Mute: Bob stops hearing Alice; Alice still hears Bob.
    bob.room.send(ClientMessage.ChatMute, { sessionId: aliceId, muted: true });
    await until(() => lastSafety(bob).muted.includes(aliceId), "bob's mute list");
    say(alice, "hello?", "ja");
    say(bob, "hi Alice");
    await until(() => alice.chat.length === 2, "alice's echo and bob's line");
    await settle();
    expect(bob.chat.map((m) => m.text)).toEqual(["hi Alice"]);
    bob.room.send(ClientMessage.ChatMute, { sessionId: aliceId, muted: false });
    await until(() => lastSafety(bob).muted.length === 0, "the unmute");
    say(alice, "now?", "ja");
    await until(() => bob.chat.length === 2, "bob to hear alice again");

    // Block: no chat either way, saved to the store.
    bob.room.send(ClientMessage.ChatBlock, { sessionId: aliceId });
    await until(() => lastSafety(bob).blocked.length === 1, "bob's block list");
    expect(lastSafety(bob).blocked).toEqual([{ uid: "alice", name: "Alice" }]);
    await until(() => h.safety.blocks.get("bob")?.length === 1, "the block list save");
    expect(h.safety.blocks.get("bob")).toEqual([{ uid: "alice", name: "Alice" }]);
    const [aliceBefore, bobBefore] = [alice.chat.length, bob.chat.length];
    say(alice, "blocked line", "ja");
    say(bob, "also blocked");
    await until(() => alice.chat.length === aliceBefore + 1 && bob.chat.length === bobBefore + 1, "the senders' echoes");
    await settle();
    expect(alice.chat.at(-1)!.from).toBe(aliceId);
    expect(bob.chat.at(-1)!.from).toBe(bobId);

    // Blocked players cannot find or ring each other at the intercom.
    bob.room.send(ClientMessage.IntercomList, {});
    await until(() => bob.intercom.length === 1, "the intercom list");
    expect(bob.intercom[0]!.players).toEqual([]);
    alice.room.send(ClientMessage.VisitRequest, { sessionId: bobId });
    await until(() => alice.status.length === 1, "the visit answer");
    expect(alice.status[0]!.state).toBe("unavailable");

    // Unblock: lines flow again, and the store follows.
    bob.room.send(ClientMessage.ChatUnblock, { uid: "alice" });
    await until(() => lastSafety(bob).blocked.length === 0, "the unblock");
    await until(() => h.safety.blocks.get("bob")?.length === 0, "the unblock save");
    say(alice, "friends again?", "ja");
    await until(() => bob.chat.at(-1)?.text === "friends again?", "bob to hear alice after the unblock");
  }, 40_000);

  it("applies a stored block list from the first line of a new session", async () => {
    const h = await start({ blocks: { alice: [{ uid: "bob", name: "Bob" }] } });
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    expect(lastSafety(alice).blocked).toEqual([{ uid: "bob", name: "Bob" }]);
    expect(lastSafety(bob).blocked).toEqual([]);
    await Promise.all([walkOut(alice), walkOut(bob)]);
    say(bob, "hey Alice");
    say(alice, "anyone?", "ja");
    await until(() => alice.chat.length === 1 && bob.chat.length === 1, "the echoes");
    await settle();
    expect(alice.chat.map((m) => m.from)).toEqual([alice.room.sessionId]);
    expect(bob.chat.map((m) => m.from)).toEqual([bob.room.sessionId]);
  }, 40_000);

  it("files reports with the server's own copy of the lines, and mutes the reported player", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    const carol = await join(h, "carol");
    await Promise.all([walkOut(alice), walkOut(bob)]);
    const aliceId = alice.room.sessionId;

    say(alice, "first", "ja");
    say(alice, "rude line", "ja");
    await until(() => bob.chat.length === 2, "bob to hear alice");
    const rude = bob.chat[1]!;

    // Carol never heard the line, so she cannot report it.
    carol.room.send(ClientMessage.ChatReport, { sessionId: aliceId, messageId: rude.id, reason: "harassment" });
    await until(() => carol.reported.length === 1, "carol's answer");
    expect(carol.reported[0]).toEqual({ ok: false });

    // A line id that is not Alice's does not count either.
    bob.room.send(ClientMessage.ChatReport, { sessionId: bob.room.sessionId, messageId: rude.id, reason: "spam" });
    await until(() => bob.reported.length === 1, "bob's first answer");
    expect(bob.reported[0]).toEqual({ ok: false });

    bob.room.send(ClientMessage.ChatReport, { sessionId: aliceId, messageId: rude.id, reason: "harassment" });
    await until(() => bob.reported.length === 2, "bob's report answer");
    expect(bob.reported[1]).toEqual({ ok: true });
    expect(h.safety.reports).toHaveLength(1);
    expect(h.safety.reports[0]).toMatchObject({
      kind: "chat",
      reporterUid: "bob",
      reportedUid: "alice",
      reportedName: "Alice",
      reason: "harassment",
      messageId: rude.id,
      shard: 1,
    });
    expect(h.safety.reports[0]!.messages.map((m) => m.text)).toEqual(["first", "rude line"]);
    // Reporting muted Alice for Bob.
    expect(lastSafety(bob).muted).toEqual([aliceId]);
    say(alice, "after the report", "ja");
    await until(() => alice.chat.length === 3, "alice's echo");
    await settle();
    expect(bob.chat).toHaveLength(2);

    // One report per few seconds.
    bob.room.send(ClientMessage.ChatReport, { sessionId: aliceId, reason: "spam" });
    await until(() => bob.reported.length === 3, "the cooldown answer");
    expect(bob.reported[2]).toEqual({ ok: false });
    expect(h.safety.reports).toHaveLength(1);
  }, 40_000);
});
