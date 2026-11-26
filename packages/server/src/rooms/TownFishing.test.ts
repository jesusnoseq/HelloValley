import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  CAST_COOLDOWN_MS,
  castExpiresAt,
  ClientMessage,
  type FishCastResultMessage,
  type FishId,
  type FishLogMessage,
  type FishResultMessage,
  getFish,
  type InventoryStateMessage,
  minReelMs,
  phaseForClockMinutes,
  RoomName,
  ServerMessage,
  type SlotEntry,
  type SpacePoint,
  type UserProfile,
  WORLD_DAY_MS,
  WORLD_EPOCH_MS,
  worldClockAt,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryFishingStore, type MemoryFishingStore } from "../fishing/fishingStore";
import { createMemoryNpcStore, type MemoryNpcStore } from "../npc/npcStore";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer } from "../server";

/**
 * Build plan M27 acceptance over the real Colyseus SDK: casts from the fishing dock by day and by
 * night land at least 5 species, every catch updates the server-side encyclopedia (`fish:log`)
 * and the bag, the Elder hears catches while he fishes on the dock, and forged messages are
 * refused (catches reported too fast, too late, twice, for unknown casts or with a made-up fish;
 * casts without a rod, away from the water, while another is out, before the cooldown). The
 * fishing clock is a fake one the test advances; the mini-game itself is client-side.
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
const SQUARE: SpacePoint = { space: "town", pos: [37, 44], heading: 0 };
const ROD: SlotEntry = { slot: 24, itemId: "fishing_rod", qty: 1 };
const NORTH = Math.PI;

/** Real time at in-game `minutes` of world day 100. */
const atMinute = (minutes: number) => WORLD_EPOCH_MS + 100 * WORLD_DAY_MS + Math.round(phaseForClockMinutes(minutes) * WORLD_DAY_MS);

let server: GameServer | null = null;
let rooms: Room[] = [];

afterEach(async () => {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Inbox<T> {
  readonly all: T[] = [];
  private seen = 0;
  constructor(room: Room, type: string) {
    room.onMessage(type, (m: T) => this.all.push(m));
  }
  async next(what = "a message", ms = 3000): Promise<T> {
    const end = Date.now() + ms;
    while (this.all.length <= this.seen) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(5);
    }
    return this.all[this.seen++]!;
  }
  drain(): void {
    this.seen = this.all.length;
  }
}

interface Angler {
  room: Room;
  cast: Inbox<FishCastResultMessage>;
  result: Inbox<FishResultMessage>;
  log: Inbox<FishLogMessage>;
  inventory: Inbox<InventoryStateMessage>;
}

interface Setup {
  url: string;
  store: MemoryNpcStore;
  fishing: MemoryFishingStore;
  clock: { now: number };
}

async function serve(spawn: SpacePoint, slots: SlotEntry[] = [ROD], startMs = atMinute(8 * 60)): Promise<Setup> {
  const store = createMemoryNpcStore({ "lia/es": { level: "A2", coins: 10, hearts: {}, slots } });
  const fishing = createMemoryFishingStore(store);
  const clock = { now: startMs };
  server = createGameServer({
    verifier: fakeVerifier,
    profiles: createMemoryProfileStore({ lia: profile("Lia") }),
    npcStore: store,
    fishing: { store: fishing, now: () => clock.now, seed: 27 },
    town: { spawn },
  });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, store, fishing, clock };
}

async function join(url: string): Promise<Angler> {
  const room = await new Client(url).joinOrCreate(RoomName.Town, { idToken: "valid:lia" });
  rooms.push(room);
  const angler = {
    room,
    cast: new Inbox<FishCastResultMessage>(room, ServerMessage.FishCast),
    result: new Inbox<FishResultMessage>(room, ServerMessage.FishResult),
    log: new Inbox<FishLogMessage>(room, ServerMessage.FishLog),
    inventory: new Inbox<InventoryStateMessage>(room, ServerMessage.InventoryState),
  };
  await angler.log.next("the encyclopedia on join");
  await angler.inventory.next("the inventory on join");
  return angler;
}

async function cast(a: Angler, charge = 1, heading = NORTH, slot = ROD.slot): Promise<FishCastResultMessage> {
  a.room.send(ClientMessage.FishCast, { slot, charge, heading });
  return a.cast.next("fish:cast");
}

async function reel(a: Angler, castId: string, outcome: "caught" | "escaped"): Promise<FishResultMessage> {
  a.room.send(ClientMessage.FishReel, { castId, outcome });
  return a.result.next("fish:result");
}

/** Casts, waits out the bite and the fastest reel on the fake clock, and reports the catch. */
async function landOne(a: Angler, s: Setup): Promise<Extract<FishResultMessage, { outcome: "caught" }>> {
  const c = await cast(a);
  if (!c.ok) throw new Error(`cast refused: ${c.reason}`);
  s.clock.now += c.biteInMs + 300 + minReelMs(c.rarity);
  const r = await reel(a, c.castId, "caught");
  if (r.outcome !== "caught") throw new Error(`catch refused: ${JSON.stringify(r)}`);
  expect(r.rarity).toBe(c.rarity);
  s.clock.now += CAST_COOLDOWN_MS;
  return r;
}

describe("M27 · fishing (TownRoom)", () => {
  it("acceptance: catches by day and by night land at least 5 species and update the encyclopedia", async () => {
    const s = await serve(DOCK);
    const lia = await join(s.url);
    const day = new Set<FishId>();
    const night = new Set<FishId>();
    let caught = 0;
    for (const [startMinute, bucket] of [
      [7 * 60, day],
      [22 * 60, night],
    ] as const) {
      s.clock.now = atMinute(startMinute);
      for (let i = 0; i < 14; i++) {
        const r = await landOne(lia, s);
        const band = worldClockAt(s.clock.now).timeOfDay;
        expect(getFish(r.fishId)!.spots).toContain("dock");
        bucket.add(r.fishId);
        caught++;
        // Every catch updates the server-side encyclopedia and the bag.
        const log = await lia.log.next("fish:log after a catch");
        expect(log.species[r.fishId]).toEqual(r.entry);
        expect(r.kept).toBe(true);
        expect((await lia.inventory.next("inventory after a catch")).slots).toContainEqual(expect.objectContaining({ itemId: r.fishId }));
        // The Elder fishes on the dock in the morning; at night he is asleep.
        expect(r.elderNearby).toBe(band === "morning");
        lia.inventory.drain();
      }
    }
    expect(new Set([...day, ...night]).size).toBeGreaterThanOrEqual(5);
    expect(night.size).toBeGreaterThanOrEqual(2);
    const stored = s.fishing.logs.get("lia")!;
    expect(Object.values(stored).reduce((n, e) => n + e!.count, 0)).toBe(caught);
    // First catches are flagged once per species.
    const firsts = lia.result.all.filter((r) => r.outcome === "caught" && r.first).length;
    expect(firsts).toBe(Object.keys(stored).length);
  });

  it("rejects forged catch messages and paces casts", async () => {
    const s = await serve(DOCK, [ROD]);
    const lia = await join(s.url);

    // A catch for a cast the server never rolled.
    expect(await reel(lia, "made-up-cast", "caught")).toEqual({ castId: "made-up-cast", outcome: "refused", reason: "no_cast" });

    // A catch reported right after the cast (no bite, no reel): refused, and the cast is over.
    const c1 = await cast(lia);
    expect(c1).toMatchObject({ ok: true, spot: "dock" });
    if (!c1.ok) return;
    expect(await cast(lia)).toEqual({ ok: false, reason: "busy" });
    s.clock.now += c1.biteInMs + 100;
    expect(await reel(lia, c1.castId, "caught")).toMatchObject({ outcome: "refused", reason: "too_soon" });
    expect(await reel(lia, c1.castId, "caught")).toMatchObject({ outcome: "refused", reason: "no_cast" });
    // The next cast waits for the cooldown.
    expect(await cast(lia)).toEqual({ ok: false, reason: "cooldown" });
    s.clock.now += CAST_COOLDOWN_MS;

    // A made-up fish in the report is not part of the message: it is dropped unanswered.
    const c2 = await cast(lia);
    if (!c2.ok) throw new Error("cast refused");
    s.clock.now += c2.biteInMs + minReelMs(c2.rarity) + 300;
    lia.room.send(ClientMessage.FishReel, { castId: c2.castId, outcome: "caught", fishId: "rainbow_koi" });
    await sleep(150);
    expect(lia.result.all).toHaveLength(3);
    // A catch reported after the cast expired.
    s.clock.now = castExpiresAt({ biteAtMs: s.clock.now, rarity: c2.rarity }) + 60_000;
    expect(await reel(lia, c2.castId, "caught")).toMatchObject({ outcome: "refused", reason: "too_late" });
    s.clock.now += CAST_COOLDOWN_MS;

    // Giving up is always fine; the encyclopedia stays empty after all of this.
    const c3 = await cast(lia);
    if (!c3.ok) throw new Error("cast refused");
    expect(await reel(lia, c3.castId, "escaped")).toEqual({ castId: c3.castId, outcome: "escaped" });
    expect(s.fishing.logs.get("lia")).toBeUndefined();
    expect(lia.log.all).toHaveLength(1);
    s.clock.now += CAST_COOLDOWN_MS;

    // Casting at the dock planks and the bank behind it, or from an empty hotbar slot.
    expect(await cast(lia, 1, 0)).toEqual({ ok: false, reason: "no_water" });
    expect(await cast(lia, 1, NORTH, 25)).toEqual({ ok: false, reason: "no_rod" });
    expect(await cast(lia, 1, NORTH, 3)).toEqual({ ok: false, reason: "no_rod" });
    expect(s.store.players.get("lia/es")!.slots).toEqual([ROD]);
  });

  it("refuses casts away from the water and without a rod in the hotbar", async () => {
    const inland = await serve(SQUARE);
    const lia = await join(inland.url);
    expect(await cast(lia)).toEqual({ ok: false, reason: "not_at_spot" });
    await lia.room.leave();
    rooms = [];
    await server?.gracefullyShutdown(false);

    // The rod in the bag (not the hotbar) does not count.
    const bagged = await serve(DOCK, [{ slot: 3, itemId: "fishing_rod", qty: 1 }]);
    const lia2 = await join(bagged.url);
    expect(await cast(lia2, 1, NORTH, 24)).toEqual({ ok: false, reason: "no_rod" });
  });

  it("releases the fish when the bag is full but still records it", async () => {
    // Every slot holds something that is not a fish (full stacks of bread), and the rod.
    const full: SlotEntry[] = Array.from({ length: 30 }, (_, slot) => (slot === 24 ? ROD : { slot, itemId: "bread", qty: 99 }));
    const s = await serve(DOCK, full);
    const lia = await join(s.url);
    const r = await landOne(lia, s);
    expect(r).toMatchObject({ kept: false, first: true });
    expect((await lia.log.next("fish:log")).species[r.fishId]).toMatchObject({ count: 1 });
    expect(s.store.players.get("lia/es")!.slots.some((e) => e.itemId === r.fishId)).toBe(false);
  });
});
