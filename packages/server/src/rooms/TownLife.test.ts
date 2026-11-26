import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  buildNpcTurnVariables,
  CAST_COOLDOWN_MS,
  ClientMessage,
  type FishCastResultMessage,
  type FishResultMessage,
  getFish,
  isNewsworthyRarity,
  minReelMs,
  NPC_POSTS,
  type NpcBarkMessage,
  type NpcContextMessage,
  type NpcRefusedMessage,
  phaseForClockMinutes,
  RoomName,
  ServerMessage,
  type SpacePoint,
  type TownNpcView,
  type UserProfile,
  VILLAGE_BATCH_MS,
  type VillagePrivacyMessage,
  visitorSpots,
  WORLD_DAY_MS,
  WORLD_EPOCH_MS,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryFishingStore } from "../fishing/fishingStore";
import { createMemoryNpcStore, type MemoryNpcStore } from "../npc/npcStore";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer, type GameServerOptions } from "../server";
import { createMemoryVillageStore, type MemoryVillageStore } from "../village/villageStore";

/**
 * Build plan M31 over the real Colyseus SDK: the acceptance (a rare catch → the village batch →
 * the Gossip's next prompt has the rumour, also after a restart), the name opt-out, villagers
 * walking their schedules in the synced state, a conversation that stops a villager on its way,
 * and an ambient exchange between related villagers reaching a player nearby.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const profile = (name: string): UserProfile => ({
  name,
  animal: "otter",
  colors: { fur: "", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "3A",
  nativeLang: "en",
  targetLangs: ["es"],
  style: "european",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});

const DOCK: SpacePoint = { space: "town", pos: [53, 30.25], heading: Math.PI };
const talkSpot = (npcId: keyof typeof NPC_POSTS): SpacePoint => ({ space: NPC_POSTS[npcId].space, pos: NPC_POSTS[npcId].talkSpot, heading: Math.PI });

/** Real time at in-game `minutes` of world day 100. */
const atMinute = (minutes: number) => WORLD_EPOCH_MS + 100 * WORLD_DAY_MS + Math.round(phaseForClockMinutes(minutes) * WORLD_DAY_MS);

let server: GameServer | null = null;
let rooms: Room[] = [];

afterEach(async () => {
  await stop();
});

async function stop(): Promise<void> {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const next = <T>(room: Room, type: string, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
    room.onMessage(type, (m: T) => {
      clearTimeout(timer);
      resolve(m);
    });
  });

async function until(check: () => boolean, what: string, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

async function serve(options: Partial<GameServerOptions> & { spawn: SpacePoint }): Promise<string> {
  server = createGameServer({ verifier: fakeVerifier, profiles: createMemoryProfileStore({ lia: profile("Lia") }), ...options, town: { spawn: options.spawn } });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function join(url: string): Promise<Room> {
  const room = await new Client(url).joinOrCreate(RoomName.Town, { idToken: "valid:lia" });
  rooms.push(room);
  return room;
}

const npcs = (room: Room) => (room.state as { npcs?: Map<string, TownNpcView> }).npcs;

/** Fishes from the dock until a rare (or legendary) fish lands; the fishing seed makes this deterministic. */
async function landRare(room: Room, clock: { now: number }): Promise<string> {
  for (let i = 0; i < 120; i++) {
    const castP = next<FishCastResultMessage>(room, ServerMessage.FishCast);
    room.send(ClientMessage.FishCast, { slot: 24, charge: 1, heading: Math.PI });
    const c = await castP;
    if (!c.ok) throw new Error(`cast refused: ${c.reason}`);
    clock.now += c.biteInMs + 300 + minReelMs(c.rarity);
    const resultP = next<FishResultMessage>(room, ServerMessage.FishResult);
    room.send(ClientMessage.FishReel, { castId: c.castId, outcome: "caught" });
    const r = await resultP;
    clock.now += CAST_COOLDOWN_MS;
    if (r.outcome === "caught" && isNewsworthyRarity(r.rarity)) return r.fishId;
  }
  throw new Error("no rare fish in 120 casts");
}

async function talkTo(room: Room, npcId: "gossip" | "elder" | "baker"): Promise<NpcContextMessage> {
  const ctxP = next<NpcContextMessage>(room, ServerMessage.NpcContext);
  room.send(ClientMessage.NpcStart, { npcId });
  return ctxP;
}

describe("M31 · village memory (TownRoom)", () => {
  it("acceptance: a rare catch becomes a rumour in the Gossip's next prompt (and survives a restart)", async () => {
    const clock = { now: atMinute(14 * 60) };
    const npcStore: MemoryNpcStore = createMemoryNpcStore({ "lia/es": { level: "B1", coins: 0, hearts: {}, slots: [{ slot: 24, itemId: "fishing_rod", qty: 1 }] } });
    const villageStore: MemoryVillageStore = createMemoryVillageStore();
    const shared = { npcStore, village: { store: villageStore, now: () => clock.now } };

    // 1. Lia lands a rare fish on the dock: the server logs it as a public event of shard 1.
    const url = await serve({ ...shared, spawn: DOCK, fishing: { store: createMemoryFishingStore(npcStore), now: () => clock.now, seed: 31 } });
    const angler = await join(url);
    const fishId = await landRare(angler, clock);
    const fishName = getFish(fishId)!.englishName.toLowerCase();
    await until(() => (villageStore.events.get("valley-1") ?? []).length > 0, "the event in village/valley-1/events");
    expect(villageStore.events.get("valley-1")![0]).toMatchObject({ type: "fish_caught", actorName: "Lia", payload: { fishId, place: "fishing_dock" } });

    // Before the batch, the Gossip has no news yet; the batch turns the event into a rumour.
    clock.now += VILLAGE_BATCH_MS;
    await server!.village.runBatch();
    expect(server!.village.news(1, "gossip").join(" ")).toContain(fishName);
    await stop();

    // 2. A restarted server reads the shard's log back; Lia talks to the Gossip at her house.
    const url2 = await serve({ ...shared, spawn: talkSpot("gossip") });
    const lia = await join(url2);
    await server!.village.runBatch();
    const ctx = await talkTo(lia, "gossip");
    expect(ctx.news.join(" ")).toContain(fishName);
    expect(ctx.news[0]).toMatch(/^Lia caught a (rare|legendary) /);
    const vars = buildNpcTurnVariables(ctx, { name: "Lia", animal: "otter", apartmentId: "3A" });
    expect(String(vars.village_news)).toContain(fishName);
    expect(vars.is_gossip).toBe(true);
  }, 30_000);

  it("lets a player opt out of being named; the Baker hears no village news", async () => {
    const npcStore = createMemoryNpcStore({ "lia/es": { level: "B1", coins: 0, hearts: {}, slots: [] } });
    const villageStore = createMemoryVillageStore();
    const url = await serve({ npcStore, village: { store: villageStore }, spawn: talkSpot("baker") });
    const room = await join(url);
    await sleep(100);
    const answerP = next<VillagePrivacyMessage>(room, ServerMessage.VillagePrivacy);
    room.send(ClientMessage.VillagePrivacy, { named: false });
    expect(await answerP).toEqual({ named: false });
    expect(villageStore.privacies.get("lia")).toBe(false);
    await server!.village.log(1, { uid: "lia", name: "Lia" }, { type: "lost_returned", payload: { itemId: "lost_hat", owner: "farmer" } });
    expect(server!.village.events(1)[0]!.actorName).toBeUndefined();
    await server!.village.runBatch();
    expect(server!.village.news(1, "gossip")[0]).toMatch(/^someone found the Farmer's lost straw hat/);
    expect((await talkTo(room, "baker")).news).toEqual([]);
  });
});

describe("M31 · NPC life (TownRoom)", () => {
  it("walks the villagers along their schedules, and a conversation stops one on its way", async () => {
    // A fast world: 20× real time, starting just before the Baker's lunch at the square bench.
    const base = atMinute(11 * 60 + 58);
    const real = Date.now();
    const speed = { x: 0 };
    const now = () => base + (Date.now() - real) * speed.x;
    const npcStore = createMemoryNpcStore({ "lia/es": { level: "B1", coins: 0, hearts: {}, slots: [] } });
    const url = await serve({ npcStore, life: { now, random: () => 0.5 }, spawn: talkSpot("baker") });
    const room = await join(url);
    await until(() => npcs(room)?.size === 9, "nine villagers in the state");
    expect(npcs(room)!.get("baker")).toMatchObject({ space: "bakery", x: NPC_POSTS.baker.pos[0], z: NPC_POSTS.baker.pos[1], motion: "idle" });

    // Lia talks to the Baker; noon comes, but the Baker stays and faces her.
    const ctx = await talkTo(room, "baker");
    speed.x = 20;
    await sleep(800);
    expect(npcs(room)!.get("baker")).toMatchObject({ space: "bakery", motion: "idle" });
    // Goodbye lets her go: she walks out of the bakery towards the square bench.
    room.send(ClientMessage.NpcEnd, { conversationId: ctx.conversationId });
    await until(() => npcs(room)!.get("baker")!.space === "town", "the Baker out in town", 8000);
    // She is no longer behind her counter: talking to her from there is too far.
    const refusedP = next<NpcRefusedMessage>(room, ServerMessage.NpcRefused);
    room.send(ClientMessage.NpcStart, { npcId: "baker" });
    expect(await refusedP).toMatchObject({ reason: "too_far", npcId: "baker" });
  }, 30_000);

  it("sends an exchange between related villagers to a player nearby", async () => {
    // 15:30: the Barista reads at the library, where the Librarian works (a secret crush).
    const clock = atMinute(15 * 60 + 30);
    const start = Date.now();
    const npcStore = createMemoryNpcStore({ "lia/es": { level: "B1", coins: 0, hearts: {}, slots: [] } });
    const spot = visitorSpots("library")[0]!;
    const url = await serve({ npcStore, life: { now: () => clock + (Date.now() - start), random: () => 0 }, spawn: { space: "library", pos: [spot[0], spot[1] + 0.6], heading: 0 } });
    const room = await join(url);
    const bark = await next<NpcBarkMessage>(room, ServerMessage.NpcBark, 5000);
    expect(bark).toMatchObject({ kind: "exchange", a: "barista", b: "librarian", index: 0 });
    expect(bark.id).toEqual(expect.any(String));
  }, 15_000);
});
