import type { FishingSpot } from "../data/fish";
import { type NpcDef, schedulePointAt } from "../data/npcs";
import { headingFor } from "../world/movement";
import { isWalkable, townDecks } from "../world/navgrid";
import { type SpaceId, spaceGrid } from "../world/player";
import { TOWN_PROPS } from "../world/props";
import { groundAt, type GroundMap } from "../world/terrain";
import { type Area, rectToTown, TOWN_PROPS_LAYOUT, townGround, townPlaces, type Vec2 } from "../world/town";

/**
 * Where you can fish (build plan M27, GDD §5.2): from the fishing dock and from the river banks,
 * plus one secret spot the Elder reveals at 5 hearts (npc-runtime.md Elder persona). Pure town
 * data, so the server checks a cast against the same rules the client shows: the player's
 * server-side position must be at a spot, and the bobber must land in the river.
 */

/** A bank spot: standing on walkable land within this distance of river water (metres, my number). */
export const BANK_REACH_M = 1.5;
/** Slack around the dock deck for the server's check (position reports lag a little). */
export const SPOT_SLACK_M = 0.35;
/** Cast distance range: a short tap lands this close, a full charge this far (metres, my numbers). */
export const CAST_MIN_M = 1.5;
export const CAST_MAX_M = 5;
/** Holding the cast button this long reaches the full distance. */
export const CAST_CHARGE_MS = 1200;
/** Hearts with the Elder that unlock the secret spot (npc-runtime.md: "at 5 hearts, reveal a secret fishing spot"). */
export const SECRET_SPOT_HEARTS = 5;
/** The secret spot: the quiet north bank of the river's west reach, below the hill. TODO(M31): the Elder hints at it in his dialogue. */
export const SECRET_SPOT_AREA: Area = [1.5, 23.75, 6, 26];

const inArea = (a: Area, p: Vec2, slack = 0) => p[0] >= a[0] - slack && p[0] <= a[2] + slack && p[1] >= a[1] - slack && p[1] <= a[3] + slack;

let ground: GroundMap | undefined;
let decks: Area[] | undefined;
const townWater = () => (ground ??= townGround());

/** Is (x, z) river water? (Outside the town, no.) */
export function isRiverWater(x: number, z: number): boolean {
  const map = townWater();
  if (x < 0 || z < 0 || x >= map.w || z >= map.d) return false;
  return groundAt(map, x, z) === "water";
}

/** Open water a bobber can land on: river water that is not under the bridge or the dock deck. */
export function isOpenWater(x: number, z: number): boolean {
  return isRiverWater(x, z) && !(decks ??= townDecks()).some((d) => inArea(d, [x, z]));
}

/** The fishing dock's deck in the town frame (x0, z0, x1, z1). */
let deck: Area | undefined;
export function dockDeck(): Area {
  if (deck) return deck;
  const dock = TOWN_PROPS_LAYOUT.find((p) => p.module === "dock.fishing");
  const walk = (TOWN_PROPS["dock.fishing"] as { walk?: Area }).walk;
  if (!dock || !walk) throw new Error("the town has no fishing dock");
  return (deck = rectToTown(dock, walk));
}


/** Distance from `p` to the nearest river water within `reach` (sampled), or Infinity. */
export function distanceToWater(p: Vec2, reach = BANK_REACH_M): number {
  let best = Infinity;
  const step = 0.25;
  for (let dz = -reach; dz <= reach + 1e-9; dz += step) {
    for (let dx = -reach; dx <= reach + 1e-9; dx += step) {
      const d = Math.hypot(dx, dz);
      if (d <= reach && d < best && isRiverWater(p[0] + dx, p[1] + dz)) best = d;
    }
  }
  return best;
}

/**
 * The kind of spot a player stands at, or null when they cannot fish here. `elderHearts` decides
 * whether the secret spot counts as secret (else it is an ordinary bank spot); the client, which
 * does not know the hearts, passes nothing and the server's answer names the spot.
 */
export function fishingSpotAt(space: SpaceId, pos: Vec2, options: { elderHearts?: number; slack?: number } = {}): FishingSpot | null {
  if (space !== "town") return null;
  const slack = options.slack ?? 0;
  if (inArea(dockDeck(), pos, slack)) return "dock";
  if (!isWalkable(spaceGrid("town"), pos)) return null;
  if (distanceToWater(pos, BANK_REACH_M + slack) === Infinity) return null;
  if (inArea(SECRET_SPOT_AREA, pos, slack) && (options.elderHearts ?? 0) >= SECRET_SPOT_HEARTS) return "secret";
  return "bank";
}

/** Cast charge 0–1 for a hold of `heldMs`. */
export function castCharge(heldMs: number): number {
  if (!Number.isFinite(heldMs) || heldMs <= 0) return 0;
  return Math.min(1, heldMs / CAST_CHARGE_MS);
}

/** How far a cast of `charge` (0–1) flies. */
export function castDistance(charge: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(charge) ? charge : 0));
  return CAST_MIN_M + (CAST_MAX_M - CAST_MIN_M) * c;
}

/** A point `distance` metres along `heading` (three.js rotation.y: forward = (sin h, cos h)). */
export function alongHeading(pos: Vec2, heading: number, distance: number): Vec2 {
  return [pos[0] + Math.sin(heading) * distance, pos[1] + Math.cos(heading) * distance];
}

/** Step of the cast ray (metres). */
const CAST_STEP_M = 0.25;

/**
 * Where a cast of `distance` metres along `heading` lands: the farthest open-water point on the
 * way, stopping where the line would reach the far bank (or a deck) again, so a long cast over the
 * narrow river falls in the water short of the other side. Null when the line never reaches open
 * water (casting at land). The landing distance is part of the answer (it shifts the odds).
 */
export function castLanding(pos: Vec2, heading: number, distance: number): { point: Vec2; distance: number } | null {
  let last: { point: Vec2; distance: number } | null = null;
  const max = Math.min(distance, CAST_MAX_M);
  for (let d = CAST_STEP_M; d <= max + 1e-9; d += CAST_STEP_M) {
    const p = alongHeading(pos, heading, d);
    if (isOpenWater(p[0], p[1])) last = { point: p, distance: d };
    else if (last) break;
  }
  return last;
}

/**
 * The heading that faces the nearest open water from `pos` (the client turns the player to the
 * water when a cast starts; ties go to the heading closest to `prefer`), or null when there is no
 * water within CAST_MAX_M.
 */
export function headingToWater(pos: Vec2, prefer = 0): number | null {
  let best: { d: number; off: number; h: number } | null = null;
  for (let i = 0; i < 32; i++) {
    const h = (i / 32) * Math.PI * 2;
    const off = Math.abs(Math.atan2(Math.sin(h - prefer), Math.cos(h - prefer)));
    for (let d = CAST_STEP_M; d <= CAST_MAX_M + 1e-9; d += CAST_STEP_M) {
      const [x, z] = alongHeading(pos, h, d);
      if (isOpenWater(x, z)) {
        if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) < 1e-9 && off < best.off)) best = { d, off, h };
        break;
      }
    }
  }
  return best ? best.h : null;
}

// ---------------------------------------------------------------------------------------------
// The Elder on the dock (GDD §5.2: "often on the dock and comments on your catch")

/** Where the Elder stands while his schedule says `fishing_dock` (the north end of the deck). */
export function elderDockSpot(): Vec2 {
  const deck = dockDeck();
  return [deck[2] - 0.35, deck[1] + 0.4];
}

/** The Elder faces the water (north) while fishing. */
export const ELDER_DOCK_FACING = headingFor([0, -1]);

/** A catch within this distance of the Elder on the dock gets his comment (metres, my number). */
export const ELDER_BARK_RADIUS_M = 8;

/** Is the Elder fishing on the dock at this in-game minute (his schedule, data/npcs.ts)? */
export function elderAtDock(elder: NpcDef, minuteOfDay: number): boolean {
  return schedulePointAt(elder, minuteOfDay)?.place === "fishing_dock";
}

/** Is a player at `pos` in the town close enough to the Elder on the dock to hear him? */
export function nearElderOnDock(elder: NpcDef, minuteOfDay: number, space: SpaceId, pos: Vec2): boolean {
  if (space !== "town" || !elderAtDock(elder, minuteOfDay)) return false;
  const spot = elderDockSpot();
  return Math.hypot(pos[0] - spot[0], pos[1] - spot[1]) <= ELDER_BARK_RADIUS_M;
}

/** The place the town layout calls the fishing dock (labels, schedules). */
export const fishingDockPlace = (): Vec2 => townPlaces().fishing_dock;
