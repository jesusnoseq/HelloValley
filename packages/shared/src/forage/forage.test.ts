import { describe, expect, it } from "vitest";
import { FORAGE_ZONES, getForage, LOST_ITEMS } from "../data/forage";
import { npcContextFixture } from "../npc/fixtures";
import { newBond } from "../npc/friendship";
import { buildNpcTurnVariables } from "../npc/prompt";
import { parseClientMessage } from "../protocol/schemas";
import { ClientMessage } from "../protocol/messages";
import { circleFits } from "../world/movement";
import { townNavGrid } from "../world/navgrid";
import { FORAGE_ZONE_AREAS, townPlaces } from "../world/town";
import { albumStats, cleanAlbum, emptyAlbum, recordFind, recordReturn } from "./album";
import { applyLostReturn, LOST_ITEM_RETURN_HEARTS, lostItemFlags, lostItemHints } from "./lost";
import {
  dailySpawns,
  FORAGE_SPAWNS_PER_ZONE,
  judgePick,
  LOST_ITEM_OFFSET_M,
  LOST_ITEMS_PER_DAY,
  nearestSpawn,
  PICK_RADIUS_M,
  PICK_SLACK_M,
  SPAWN_SPACING_M,
} from "./spawns";

const player = { name: "Lia", animal: "otter", apartmentId: "3A" };
const inside = (p: readonly number[], [x0, z0, x1, z1]: readonly number[]) => p[0]! >= x0! && p[0]! <= x1! && p[1]! >= z0! && p[1]! <= z1!;

describe("daily forage spawns (build plan M28)", () => {
  it("are the same for the same shard and in-game day (a restart recomputes them)", () => {
    expect(dailySpawns(1, 500)).toEqual(dailySpawns(1, 500));
  });

  it("reset each in-game day and differ between shards", () => {
    const today = dailySpawns(1, 500);
    const tomorrow = dailySpawns(1, 501);
    expect(tomorrow.map((s) => s.pos)).not.toEqual(today.map((s) => s.pos));
    // Yesterday's ids never match today's.
    const ids = new Set(today.map((s) => s.spawnId));
    expect(tomorrow.some((s) => ids.has(s.spawnId))).toBe(false);
    expect(dailySpawns(2, 500).map((s) => s.pos)).not.toEqual(today.map((s) => s.pos));
  });

  it("put forage of the right zone on walkable, spaced-out points inside the zone", () => {
    for (const day of [0, 1, 77, 500, 12345]) {
      const spawns = dailySpawns(3, day);
      const forage = spawns.filter((s) => s.kind === "forage");
      const total = FORAGE_ZONES.reduce((n, z) => n + FORAGE_SPAWNS_PER_ZONE[z], 0);
      expect(forage.length).toBeGreaterThanOrEqual(total - 2);
      for (const s of forage) {
        expect(s.spawnId).toMatch(new RegExp(`^d${day}-\\d+$`));
        expect(getForage(s.itemId)?.zones).toContain(s.zone);
        expect(FORAGE_ZONE_AREAS[s.zone!].some((a) => inside(s.pos, a))).toBe(true);
        expect(circleFits(townNavGrid(), s.pos)).toBe(true);
      }
      for (const a of spawns) for (const b of spawns) if (a !== b) expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])).toBeGreaterThanOrEqual(SPAWN_SPACING_M - 0.02);
      expect(new Set(spawns.map((s) => s.spawnId)).size).toBe(spawns.length);
    }
  });

  it("lay lost items near one of the places the Gossip hints at", () => {
    const seen = new Set<string>();
    for (let day = 0; day < 40; day++) {
      const lost = dailySpawns(1, day).filter((s) => s.kind === "lost");
      expect(lost).toHaveLength(LOST_ITEMS_PER_DAY);
      for (const s of lost) {
        seen.add(s.itemId);
        const def = LOST_ITEMS.find((l) => l.id === s.itemId)!;
        expect(def.hintPlaces).toContain(s.place);
        expect(s.owner).toBe(def.owner);
        const c = townPlaces()[s.place!];
        expect(Math.hypot(s.pos[0] - c[0], s.pos[1] - c[1])).toBeLessThanOrEqual(LOST_ITEM_OFFSET_M[1] + 0.02);
        expect(circleFits(townNavGrid(), s.pos)).toBe(true);
      }
    }
    // Over a few weeks every villager loses something.
    expect(seen.size).toBe(LOST_ITEMS.length);
  });
});

describe("pick-ups are judged by the server's position", () => {
  const spawn = dailySpawns(1, 500)[0]!;
  it("accepts a pick-up within reach", () => {
    expect(judgePick(spawn, false, "town", spawn.pos)).toEqual({ ok: true });
    expect(judgePick(spawn, false, "town", [spawn.pos[0] + PICK_RADIUS_M + PICK_SLACK_M - 0.01, spawn.pos[1]])).toEqual({ ok: true });
  });
  it("rejects forged pick-ups: unknown or other-day ids, taken spawns, too far, indoors", () => {
    expect(judgePick(undefined, false, "town", spawn.pos)).toEqual({ ok: false, reason: "unknown_spawn" });
    expect(judgePick(spawn, true, "town", spawn.pos)).toEqual({ ok: false, reason: "taken" });
    expect(judgePick(spawn, false, "town", [spawn.pos[0] + 3, spawn.pos[1]])).toEqual({ ok: false, reason: "too_far" });
    expect(judgePick(spawn, false, "bakery", spawn.pos)).toEqual({ ok: false, reason: "indoors" });
  });
  it("finds the nearest spawn within reach for the F prompt", () => {
    const spawns = dailySpawns(1, 500);
    expect(nearestSpawn(spawns, spawn.pos)).toEqual(spawn);
    expect(nearestSpawn(spawns, [-50, -50])).toBeNull();
  });
});

describe("lost items (GDD §5.3)", () => {
  it("returning a lost item to its owner adds hearts, once per item per in-game day", () => {
    const first = applyLostReturn(newBond(2), "librarian", "lost_glasses", null, 10);
    expect(first).toEqual({ ok: true, bond: { ...newBond(2), hearts: 2 + LOST_ITEM_RETURN_HEARTS }, delta: LOST_ITEM_RETURN_HEARTS, rewarded: true });
    expect(applyLostReturn(newBond(2), "librarian", "lost_glasses", 9, 10)).toMatchObject({ ok: true, delta: LOST_ITEM_RETURN_HEARTS });
    expect(applyLostReturn(newBond(3.5), "librarian", "lost_glasses", 10, 10)).toMatchObject({ ok: true, delta: 0, rewarded: false, bond: { hearts: 3.5 } });
    // Hearts stay within 0..10.
    expect(applyLostReturn(newBond(9.5), "librarian", "lost_glasses", null, 10)).toMatchObject({ ok: true, delta: 0.5, bond: { hearts: 10 } });
  });
  it("only the owner takes it, and only lost items count", () => {
    expect(applyLostReturn(newBond(2), "baker", "lost_glasses", null, 10)).toEqual({ ok: false, reason: "not_owner" });
    expect(applyLostReturn(newBond(2), "librarian", "bread", null, 10)).toEqual({ ok: false, reason: "not_lost_item" });
  });
  it("tells NPCs about the lost items the player carries", () => {
    const inv = [{ itemId: "lost_glasses", qty: 1 }, { itemId: "bread", qty: 2 }];
    expect(lostItemFlags("librarian", inv)).toEqual(["the player found your lost reading glasses and is carrying it (they can give it back to you)"]);
    expect(lostItemFlags("baker", inv)).toEqual(["the player is carrying the Librarian's lost reading glasses"]);
    expect(lostItemFlags("baker", [{ itemId: "bread", qty: 1 }])).toEqual([]);
  });
  it("gives the Gossip a hint context with each lost item's place, and nobody else", () => {
    const spawns = dailySpawns(1, 500);
    const hints = lostItemHints(spawns);
    expect(hints).toHaveLength(LOST_ITEMS_PER_DAY);
    expect(hints.map((h) => h.itemId)).toEqual(spawns.filter((s) => s.kind === "lost").map((s) => s.itemId));
    // A picked item is no longer hinted at.
    expect(lostItemHints(spawns.filter((s) => s.itemId !== hints[0]!.itemId))).toHaveLength(LOST_ITEMS_PER_DAY - 1);

    const hint = { itemId: "lost_glasses" as const, owner: "librarian" as const, place: "bridge" as const };
    const gossip = { ...npcContextFixture({ lang: "es", playerLevel: "A2", npcId: "gossip" }), hints: [hint] };
    const vars = buildNpcTurnVariables(gossip, player);
    expect(JSON.parse(String(vars.lost_item_hints))).toEqual([{ item: "Reading glasses", owner: "Librarian", near: "the bridge" }]);
    const baker = { ...npcContextFixture({ lang: "es", playerLevel: "A2" }), hints: [hint] };
    expect(buildNpcTurnVariables(baker, player).lost_item_hints).toBe("");
  });
  it("parses forage:pick and npc:return, refusing malformed ones", () => {
    expect(parseClientMessage(ClientMessage.ForagePick, { spawnId: "d500-3" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.ForagePick, { spawnId: "../x" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.ForagePick, { spawnId: "d500-3", itemId: "old_coin" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.NpcReturn, { conversationId: "c-1", itemId: "lost_hat" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.NpcReturn, { conversationId: "c-1", itemId: "bread" }).ok).toBe(false);
  });
});

describe("forage album", () => {
  it("counts finds and returns", () => {
    let album = emptyAlbum();
    let r = recordFind(album, "daisy", 1000);
    expect(r.first).toBe(true);
    r = recordFind(r.album, "daisy", 2000);
    expect(r).toMatchObject({ first: false, entry: { count: 2, firstMs: 1000, lastMs: 2000 } });
    album = recordFind(r.album, "lost_hat", 3000).album;
    album = recordReturn(recordReturn(album, "lost_hat", 7), "lost_hat", 9);
    expect(album.returned.lost_hat).toEqual({ count: 2, lastDay: 9 });
    const stats = albumStats(album);
    expect(stats.forage.found).toBe(1);
    expect(stats.lost.found).toBe(1);
    expect(stats.returned).toBe(2);
    expect(stats.byKind.flower).toEqual({ found: 1, of: 3 });
  });
  it("cleans a stored album", () => {
    const clean = cleanAlbum({
      found: { daisy: { count: 1, firstMs: 1, lastMs: 1 }, bread: { count: 1, firstMs: 1, lastMs: 1 }, poppy: { count: 0, firstMs: 1, lastMs: 1 } },
      returned: { lost_hat: { count: 1, lastDay: 4 }, daisy: { count: 1, lastDay: 4 } },
    });
    expect(clean).toEqual({ found: { daisy: { count: 1, firstMs: 1, lastMs: 1 } }, returned: { lost_hat: { count: 1, lastDay: 4 } } });
  });
});
