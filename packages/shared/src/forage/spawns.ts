import { FORAGE_ZONES, type ForageId, type ForageZone, forageTable, LOST_ITEMS, type LostItemId } from "../data/forage";
import type { NpcId } from "../data/npcs";
import type { PlaceId } from "../data/world";
import { createRng, pickWeighted, type Rng, seedFrom } from "../fishing/rng";
import { circleFits } from "../world/movement";
import { townNavGrid } from "../world/navgrid";
import type { SpaceId } from "../world/player";
import { FORAGE_ZONE_AREAS, townPlaces, type Vec2 } from "../world/town";

/**
 * Daily forage spawns (build plan M28, GDD §5.3, architecture §3.1): every in-game day each town
 * shard gets its own set of flowers, mushrooms, shells, pebbles, berries and herbs in the forage
 * zones, plus a couple of lost NPC items near one of the places the Gossip can hint at. The set
 * is a pure function of (shard, in-game day), so the server recomputes the same one after a
 * restart and a new day brings a fresh one. Only which spawns were picked is server state.
 *
 * Numbers are mine (the GDD gives none): 20 forage spawns a day (meadow 5, forest edge 4,
 * riverbank 5, hill 4, square 2) and 2 of the 6 lost items.
 */

/** Forage spawns per zone per in-game day. */
export const FORAGE_SPAWNS_PER_ZONE: Readonly<Record<ForageZone, number>> = {
  meadow: 5,
  forest_edge: 4,
  riverbank: 5,
  hill: 4,
  square: 2,
};
/** Lost items lying around per shard per in-game day. */
export const LOST_ITEMS_PER_DAY = 2;
/** Spawns keep at least this far apart (metres). */
export const SPAWN_SPACING_M = 1.5;
/** A lost item lies this far from the place the Gossip names (metres). */
export const LOST_ITEM_OFFSET_M: readonly [number, number] = [1.5, 3.5];
/** You pick a spawn up within this distance of it (metres, my number). */
export const PICK_RADIUS_M = 1.2;
/** Slack on the pick range for the server check (position reports lag the client a little). */
export const PICK_SLACK_M = 0.5;
/** Shortest gap between two pick-ups of one player (ms, my number). */
export const PICK_COOLDOWN_MS = 300;
/** Tries per spawn to find a free walkable point before giving up on it. */
const PLACEMENT_TRIES = 40;

export type SpawnKind = "forage" | "lost";
export type CollectibleId = ForageId | LostItemId;

export interface ForageSpawn {
  /** `d{day}-{n}`: unique per shard and day, so yesterday's ids never match today's. */
  spawnId: string;
  kind: SpawnKind;
  itemId: CollectibleId;
  /** Town frame, metres (spawns are always in the town space). */
  pos: Vec2;
  /** With kind `forage`: the zone it grew in. */
  zone?: ForageZone;
  /** With kind `lost`: the place it lies near (the Gossip's hint). */
  place?: PlaceId;
  /** With kind `lost`: whose it is. */
  owner?: NpcId;
}

/** The seed of one shard's spawns on one in-game day. */
export function spawnSeed(shard: number, day: number): number {
  return seedFrom("forage", shard, day);
}

const inArea = (rng: Rng, [x0, z0, x1, z1]: readonly number[]): Vec2 => [x0! + rng() * (x1! - x0!), z0! + rng() * (z1! - z0!)];

function free(p: Vec2, taken: readonly Vec2[]): boolean {
  return circleFits(townNavGrid(), p) && taken.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= SPAWN_SPACING_M);
}

/** A walkable point in one of the zone's areas, away from the other spawns; null if none was found. */
function pointInZone(zone: ForageZone, rng: Rng, taken: readonly Vec2[]): Vec2 | null {
  const areas = FORAGE_ZONE_AREAS[zone];
  for (let i = 0; i < PLACEMENT_TRIES; i++) {
    const area = areas[Math.floor(rng() * areas.length)]!;
    const p = inArea(rng, area);
    if (free(p, taken)) return p;
  }
  return null;
}

/** A walkable point a few metres from a place, away from the other spawns. */
function pointNear(place: PlaceId, rng: Rng, taken: readonly Vec2[]): Vec2 | null {
  const centre = townPlaces()[place];
  const [r0, r1] = LOST_ITEM_OFFSET_M;
  for (let i = 0; i < PLACEMENT_TRIES; i++) {
    const a = rng() * Math.PI * 2;
    const r = r0 + rng() * (r1 - r0);
    const p: Vec2 = [centre[0] + Math.cos(a) * r, centre[1] + Math.sin(a) * r];
    if (free(p, taken)) return p;
  }
  return null;
}

const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Every spawn of one shard on one in-game day, in a fixed order (forage by zone, then the lost
 * items). Deterministic: the same (shard, day) always gives the same list.
 */
export function dailySpawns(shard: number, day: number): ForageSpawn[] {
  const rng = createRng(spawnSeed(shard, day));
  const taken: Vec2[] = [];
  const out: ForageSpawn[] = [];
  const id = () => `d${day}-${out.length}`;
  for (const zone of FORAGE_ZONES) {
    const table = forageTable(zone);
    for (let i = 0; i < FORAGE_SPAWNS_PER_ZONE[zone]; i++) {
      const itemId = pickWeighted(table, rng);
      const p = itemId ? pointInZone(zone, rng, taken) : null;
      if (!itemId || !p) continue;
      const pos: Vec2 = [round(p[0]), round(p[1])];
      taken.push(pos);
      out.push({ spawnId: id(), kind: "forage", itemId, pos, zone });
    }
  }
  // A partial Fisher–Yates shuffle picks which lost items are out today.
  const lost = [...LOST_ITEMS];
  for (let i = 0; i < Math.min(LOST_ITEMS_PER_DAY, lost.length); i++) {
    const j = i + Math.floor(rng() * (lost.length - i));
    [lost[i], lost[j]] = [lost[j]!, lost[i]!];
    const item = lost[i]!;
    const place = item.hintPlaces[Math.floor(rng() * item.hintPlaces.length)]!;
    const p = pointNear(place, rng, taken);
    if (!p) continue;
    const pos: Vec2 = [round(p[0]), round(p[1])];
    taken.push(pos);
    out.push({ spawnId: id(), kind: "lost", itemId: item.id, pos, place, owner: item.owner });
  }
  return out;
}

/** Why a pick-up was refused. */
export type ForagePickRefusal = "unknown_spawn" | "taken" | "too_far" | "indoors" | "talking" | "cooldown" | "bag_full" | "already_have" | "unavailable";

/**
 * The server's range check for a pick-up (from its own walker position, never the client's):
 * the spawn must exist today and still be there, and the player must stand in town within
 * PICK_RADIUS_M (+ slack) of it.
 */
export function judgePick(
  spawn: ForageSpawn | undefined,
  gone: boolean,
  space: SpaceId,
  pos: Vec2,
  slack = PICK_SLACK_M,
): { ok: true } | { ok: false; reason: "unknown_spawn" | "taken" | "too_far" | "indoors" } {
  if (!spawn) return { ok: false, reason: "unknown_spawn" };
  if (gone) return { ok: false, reason: "taken" };
  if (space !== "town") return { ok: false, reason: "indoors" };
  if (Math.hypot(pos[0] - spawn.pos[0], pos[1] - spawn.pos[1]) > PICK_RADIUS_M + slack) return { ok: false, reason: "too_far" };
  return { ok: true };
}

/** The spawn nearest to `pos` within PICK_RADIUS_M (the client's F prompt), or null. */
export function nearestSpawn<T extends { pos: Vec2 }>(spawns: Iterable<T>, pos: Vec2, radius = PICK_RADIUS_M): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const s of spawns) {
    const d = Math.hypot(pos[0] - s.pos[0], pos[1] - s.pos[1]);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
