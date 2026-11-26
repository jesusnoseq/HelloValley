import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ClientMessage,
  dailySpawns,
  type ForageAlbumMessage,
  type ForageResultMessage,
  type InventoryStateMessage,
  LOST_ITEM_RETURN_HEARTS,
  lostItemHints,
  NPC_POSTS,
  type NpcContextMessage,
  type NpcId,
  type NpcReturnedMessage,
  phaseForClockMinutes,
  RoomName,
  ServerMessage,
  type SlotEntry,
  type SpacePoint,
  type TownForageView,
  type UserProfile,
  WORLD_DAY_MS,
  WORLD_EPOCH_MS,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryForageStore, type MemoryForageStore } from "../forage/forageStore";
import { createMemoryNpcStore, type MemoryNpcStore } from "../npc/npcStore";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer } from "../server";

/**
 * Build plan M28 acceptance over the real Colyseus SDK: the shard's forage spawns are synced
 * state and reset each in-game day (the deterministic `dailySpawns(shard, day)`), pick-ups are
 * validated against the server's own walker (forged ones refused: unknown or other-day ids,
 * taken spawns, out of reach), a find lands in the bag and the forage album, the Gossip's
 * context lists today's lost items and their places, and returning a lost item adds hearts.
 * The forage clock is a fake one the test advances.
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

const DAY = 100;
const SHARD = 1;
const atDay = (day: number, minutes = 9 * 60) => WORLD_EPOCH_MS + day * WORLD_DAY_MS + Math.round(phaseForClockMinutes(minutes) * WORLD_DAY_MS);
const talkSpot = (npcId: NpcId): SpacePoint => ({ space: NPC_POSTS[npcId].space, pos: NPC_POSTS[npcId].talkSpot, heading: Math.PI });

let server: GameServer | null = null;
let rooms: Room[] = [];

afterEach(async () => {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, probe: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

class Inbox<T> {
  readonly all: T[] = [];
  private seen = 0;
  constructor(room: Room, type: string) {
    room.onMessage(type, (m: T) => this.all.push(m));
  }
  async next(what = "a message", ms = 3000): Promise<T> {
    await until(what, () => this.all.length > this.seen, ms);
    return this.all[this.seen++]!;
  }
}

interface Setup {
  url: string;
  store: MemoryNpcStore;
  forage: MemoryForageStore;
  clock: { now: number };
}

async function serve(spawn: SpacePoint, slots: SlotEntry[] = []): Promise<Setup> {
  const store = createMemoryNpcStore({ "lia/es": { level: "A2", coins: 10, hearts: {}, slots } });
  const forage = createMemoryForageStore(store);
  const clock = { now: atDay(DAY) };
  server = createGameServer({
    verifier: fakeVerifier,
    profiles: createMemoryProfileStore({ lia: profile("Lia") }),
    npcStore: store,
    forage: { store: forage, now: () => clock.now },
    town: { spawn },
  });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, store, forage, clock };
}

interface Forager {
  room: Room;
  result: Inbox<ForageResultMessage>;
  album: Inbox<ForageAlbumMessage>;
  inventory: Inbox<InventoryStateMessage>;
  returned: Inbox<NpcReturnedMessage>;
  context: Inbox<NpcContextMessage>;
}

async function join(url: string): Promise<Forager> {
  const room = await new Client(url).joinOrCreate(RoomName.Town, { idToken: "valid:lia" });
  rooms.push(room);
  const f = {
    room,
    result: new Inbox<ForageResultMessage>(room, ServerMessage.ForageResult),
    album: new Inbox<ForageAlbumMessage>(room, ServerMessage.ForageAlbum),
    inventory: new Inbox<InventoryStateMessage>(room, ServerMessage.InventoryState),
    returned: new Inbox<NpcReturnedMessage>(room, ServerMessage.NpcReturned),
    context: new Inbox<NpcContextMessage>(room, ServerMessage.NpcContext),
  };
  await f.album.next("the album on join");
  await f.inventory.next("the inventory on join");
  return f;
}

/** The synced forage map, as spawn id → view. */
function synced(room: Room): Map<string, TownForageView> {
  const map = (room.state as { forage?: Map<string, TownForageView> }).forage;
  const out = new Map<string, TownForageView>();
  map?.forEach((v, k) => out.set(k, { itemId: v.itemId, kind: v.kind, x: v.x, z: v.z }));
  return out;
}

async function pick(f: Forager, s: Setup, spawnId: string): Promise<ForageResultMessage> {
  s.clock.now += 1000; // past the pick-up cooldown
  f.room.send(ClientMessage.ForagePick, { spawnId });
  return f.result.next(`forage:result for ${spawnId}`);
}

describe("M28 · foraging and lost items (TownRoom)", () => {
  it("acceptance: spawns reset each in-game day, finds land in the bag and the album, forged pick-ups are refused", async () => {
    const today = dailySpawns(SHARD, DAY);
    const first = today.find((sp) => sp.kind === "forage")!;
    const s = await serve({ space: "town", pos: first.pos, heading: 0 });
    const lia = await join(s.url);

    // The state carries exactly today's set (deterministic: what the shared function says).
    const seen = await until("today's spawns in the state", () => (synced(lia.room).size === today.length ? synced(lia.room) : null));
    for (const sp of today) {
      const v = seen.get(sp.spawnId)!;
      expect(v).toMatchObject({ itemId: sp.itemId, kind: sp.kind });
      expect(v.x).toBeCloseTo(sp.pos[0], 3);
      expect(v.z).toBeCloseTo(sp.pos[1], 3);
    }

    // A pick-up within reach: into the bag and the album, and gone for everyone in the shard.
    const ok = await pick(lia, s, first.spawnId);
    expect(ok).toMatchObject({ spawnId: first.spawnId, ok: true, itemId: first.itemId, kind: "forage", first: true, entry: { count: 1 } });
    expect((await lia.inventory.next("inventory after the find")).slots).toContainEqual(expect.objectContaining({ itemId: first.itemId, qty: 1 }));
    expect((await lia.album.next("album after the find")).album.found[first.itemId]).toMatchObject({ count: 1 });
    expect(s.forage.albums.get("lia")?.found[first.itemId]?.count).toBe(1);
    await until("the picked spawn to leave the state", () => !synced(lia.room).has(first.spawnId));

    // Forged pick-ups: twice, out of reach, unknown ids, other days' ids.
    expect(await pick(lia, s, first.spawnId)).toEqual({ spawnId: first.spawnId, ok: false, reason: "taken" });
    const far = today.find((sp) => Math.hypot(sp.pos[0] - first.pos[0], sp.pos[1] - first.pos[1]) > 5)!;
    expect(await pick(lia, s, far.spawnId)).toEqual({ spawnId: far.spawnId, ok: false, reason: "too_far" });
    expect(await pick(lia, s, "d100-999")).toMatchObject({ ok: false, reason: "unknown_spawn" });
    expect(await pick(lia, s, `d${DAY + 1}-0`)).toMatchObject({ ok: false, reason: "unknown_spawn" });
    // An invalid payload (it names its own item) never reaches the handler.
    lia.room.send(ClientMessage.ForagePick, { spawnId: first.spawnId, itemId: "old_coin" });
    await sleep(100);
    expect(lia.result.all).toHaveLength(5);
    expect(s.store.players.get("lia/es")!.slots.filter((sl) => sl.itemId !== first.itemId)).toEqual([]);

    // The next in-game day brings a fresh set, and yesterday's ids no longer count.
    s.clock.now = atDay(DAY + 1);
    const tomorrow = dailySpawns(SHARD, DAY + 1);
    await until("tomorrow's spawns in the state", () => {
      const m = synced(lia.room);
      return m.size === tomorrow.length && tomorrow.every((sp) => m.has(sp.spawnId));
    });
    expect(await pick(lia, s, today[1]!.spawnId)).toMatchObject({ ok: false, reason: "unknown_spawn" });
  });

  it("acceptance: returning a lost item to its owner adds hearts (once per item per in-game day)", async () => {
    const slots: SlotEntry[] = [
      { slot: 0, itemId: "lost_glasses", qty: 2 },
      { slot: 1, itemId: "lost_hat", qty: 1 },
    ];
    const s = await serve(talkSpot("librarian"), slots);
    const lia = await join(s.url);
    lia.room.send(ClientMessage.NpcStart, { npcId: "librarian" });
    const ctx = await lia.context.next("npc:context");
    // The owner knows the player carries their glasses; the hat is someone else's.
    expect(ctx.flags).toContain("the player found your lost reading glasses and is carrying it (they can give it back to you)");
    expect(ctx.flags).toContain("the player is carrying the Farmer's lost straw hat");
    expect(ctx.hints).toEqual([]);
    const before = ctx.hearts;

    lia.room.send(ClientMessage.NpcReturn, { conversationId: ctx.conversationId, itemId: "lost_glasses" });
    const back = await lia.returned.next("npc:returned");
    expect(back).toMatchObject({ itemId: "lost_glasses", ok: true, delta: LOST_ITEM_RETURN_HEARTS, hearts: before + LOST_ITEM_RETURN_HEARTS });
    expect(back.inventory).toContainEqual({ itemId: "lost_glasses", qty: 1 });
    expect(s.store.players.get("lia/es")!.hearts.librarian).toBe(before + LOST_ITEM_RETURN_HEARTS);
    expect((await lia.album.next("album after the return")).album.returned.lost_glasses).toEqual({ count: 1, lastDay: DAY });

    // A second copy the same day is taken back for no hearts.
    lia.room.send(ClientMessage.NpcReturn, { conversationId: ctx.conversationId, itemId: "lost_glasses" });
    expect(await lia.returned.next("npc:returned")).toMatchObject({ ok: true, delta: 0, hearts: before + LOST_ITEM_RETURN_HEARTS });
    await sleep(3100); // the reply rate limit (a burst of 3)

    // Only the owner takes an item, and only one the player holds.
    lia.room.send(ClientMessage.NpcReturn, { conversationId: ctx.conversationId, itemId: "lost_hat" });
    expect(await lia.returned.next("npc:returned")).toMatchObject({ ok: false, reason: "not_owner", delta: 0 });
    lia.room.send(ClientMessage.NpcReturn, { conversationId: ctx.conversationId, itemId: "lost_glasses" });
    expect(await lia.returned.next("npc:returned")).toMatchObject({ ok: false, reason: "not_owned", delta: 0 });
    expect(s.store.players.get("lia/es")!.hearts.librarian).toBe(before + LOST_ITEM_RETURN_HEARTS);
  }, 15_000);

  it("gives the Gossip a hint context with today's lost items and where they lie", async () => {
    const s = await serve(talkSpot("gossip"));
    const lia = await join(s.url);
    lia.room.send(ClientMessage.NpcStart, { npcId: "gossip" });
    const ctx = await lia.context.next("npc:context");
    const expected = lostItemHints(dailySpawns(SHARD, DAY));
    expect(expected.length).toBeGreaterThan(0);
    expect(ctx.hints).toEqual(expected);
    expect(s.clock.now).toBeGreaterThan(0);
  });
});
