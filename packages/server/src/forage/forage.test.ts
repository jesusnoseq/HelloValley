import { dailySpawns, LOST_ITEM_RETURN_HEARTS, PICK_COOLDOWN_MS, type SlotEntry, TOTAL_SLOTS, WORLD_DAY_MS, WORLD_EPOCH_MS } from "@hellovalley/shared";
import { describe, expect, it } from "vitest";
import { createMemoryNpcStore } from "../npc/npcStore";
import { ForageService } from "./forage";
import { createMemoryForageStore } from "./forageStore";

/** The forage service on its own (build plan M28): shard days, contention, the bag and the Gossip's hints. */

const DAY = 200;
const start = WORLD_EPOCH_MS + DAY * WORLD_DAY_MS + 1000;

function setup(slots: SlotEntry[] = []) {
  const npc = createMemoryNpcStore({ "lia/es": { level: "A2", coins: 0, hearts: {}, slots }, "kai/es": { level: "A2", coins: 0, hearts: {}, slots: [] } });
  const store = createMemoryForageStore(npc);
  const clock = { now: start };
  const service = new ForageService(store, { now: () => clock.now });
  return { npc, store, clock, service };
}

const at = (pos: [number, number]) => ({ space: "town" as const, pos, talking: false });

describe("ForageService", () => {
  it("keeps one set per shard and day, and a new day starts over", () => {
    const { service, clock } = setup();
    expect(service.open(1)).toEqual({ day: DAY, spawns: dailySpawns(1, DAY) });
    expect(service.open(2).spawns).toEqual(dailySpawns(2, DAY));
    clock.now += WORLD_DAY_MS;
    expect(service.open(1)).toEqual({ day: DAY + 1, spawns: dailySpawns(1, DAY + 1) });
  });

  it("gives a spawn to the first picker only; a picked lost item leaves the Gossip's hints", async () => {
    const { service, clock } = setup();
    const lost = dailySpawns(1, DAY).find((s) => s.kind === "lost")!;
    const [a, b] = await Promise.all([service.pick("lia", "es", 1, lost.spawnId, at(lost.pos)), service.pick("kai", "es", 1, lost.spawnId, at(lost.pos))]);
    expect(a).toMatchObject({ ok: true, itemId: lost.itemId, kind: "lost" });
    expect(b).toEqual({ spawnId: lost.spawnId, ok: false, reason: "taken" });
    expect(service.hints(1).map((h) => h.itemId)).not.toContain(lost.itemId);
    // Other shards still have theirs.
    expect(service.open(2).spawns).toHaveLength(dailySpawns(2, DAY).length);
    // The pick-up cooldown.
    const other = dailySpawns(1, DAY)[0]!;
    expect(await service.pick("lia", "es", 1, other.spawnId, at(other.pos))).toMatchObject({ ok: false, reason: "cooldown" });
    clock.now += PICK_COOLDOWN_MS;
    expect(await service.pick("lia", "es", 1, other.spawnId, at(other.pos))).toMatchObject({ ok: true });
  });

  it("leaves the spawn when the bag is full or the player already holds that lost item", async () => {
    const full: SlotEntry[] = Array.from({ length: TOTAL_SLOTS }, (_, slot) => ({ slot, itemId: "fishing_rod", qty: 1 }));
    const { service, clock } = setup(full);
    const sp = dailySpawns(1, DAY)[0]!;
    expect(await service.pick("lia", "es", 1, sp.spawnId, at(sp.pos))).toMatchObject({ ok: false, reason: "bag_full" });
    expect(service.open(1).spawns.map((s) => s.spawnId)).toContain(sp.spawnId);

    const lost = dailySpawns(1, DAY).find((s) => s.kind === "lost")!;
    const held = setup([{ slot: 0, itemId: lost.itemId, qty: 1 }]);
    expect(await held.service.pick("lia", "es", 1, lost.spawnId, at(lost.pos))).toMatchObject({ ok: false, reason: "already_have" });
    clock.now += 1;
  });

  it("refuses pick-ups while talking or busy, and from players without records", async () => {
    const { service } = setup();
    const sp = dailySpawns(1, DAY)[0]!;
    expect(await service.pick("lia", "es", 1, sp.spawnId, { ...at(sp.pos), talking: true })).toMatchObject({ ok: false, reason: "talking" });
    expect(await service.pick("nobody", "es", 1, sp.spawnId, at(sp.pos))).toMatchObject({ ok: false, reason: "unavailable" });
    expect(service.open(1).spawns.map((s) => s.spawnId)).toContain(sp.spawnId);
  });

  it("returns lost items through the shared friendship rule", async () => {
    const { service, npc, store } = setup([{ slot: 0, itemId: "lost_keys", qty: 1 }]);
    const r = await service.returnLost("lia", "es", "c1", "shopkeeper", "lost_keys");
    expect(r).toMatchObject({ ok: true, returned: { ok: true, delta: LOST_ITEM_RETURN_HEARTS, hearts: LOST_ITEM_RETURN_HEARTS, inventory: [] } });
    expect(npc.players.get("lia/es")!.hearts.shopkeeper).toBe(LOST_ITEM_RETURN_HEARTS);
    expect(store.albums.get("lia")!.returned.lost_keys).toEqual({ count: 1, lastDay: DAY });
    expect(await service.returnLost("nobody", "es", "c1", "shopkeeper", "lost_keys")).toEqual({ ok: false, reason: "unavailable" });
  });
});
