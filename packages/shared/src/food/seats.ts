import { rotateXZ } from "../buildings/schema";
import { interiorLayout, pieceArea } from "../world/interiors";
import { furnitureLabelKey, propLabelKey } from "../world/labels";
import { headingFor } from "../world/movement";
import type { SpaceId } from "../world/player";
import { TOWN_PROPS } from "../world/props";
import { type Area, rectToTown, TOWN_PROPS_LAYOUT, type Vec2 } from "../world/town";

/**
 * Seats (GDD §5.4: "sitting at a café table or square bench to eat"; build plan M29): two places
 * on every town bench and the café's chairs. Sitting is a synced state (`seat` on the player): the
 * server checks the seat exists in the player's space, is within reach of its own walker and is
 * free; the avatar is drawn on the seat (the walker itself stays on the walkable ground beside
 * it) and plays the `sit` clip. Walking off stands the player up.
 * Build plan M31: sitting down opens ambient small talk with a villager nearby (server rooms/npcLife.ts `smallTalk`).
 */

export interface Seat {
  /** `bench-<n><a|b>` or `cafe-chair-<n>`. */
  id: string;
  space: SpaceId;
  /** Where the avatar sits. */
  pos: Vec2;
  /** The heading the sitter faces. */
  facing: number;
  labelKey: string;
}

/** How close to a seat the walker must stand to sit down (my number). */
export const SEAT_REACH_M = 1.2;
/** Slack on the reach for the server check (reports lag the client a little). */
export const SEAT_SLACK_M = 0.5;
/** Walking further than this from where the player sat down stands them up. */
export const STAND_UP_MOVE_M = 0.3;

const centre = (a: Area): Vec2 => [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2];

function buildSeats(): Seat[] {
  const seats: Seat[] = [];
  let bench = 0;
  for (const prop of TOWN_PROPS_LAYOUT) {
    if (prop.module !== "bench") continue;
    const area = rectToTown(prop, TOWN_PROPS.bench.blocks);
    const [cx, cz] = centre(area);
    const alongX = area[2] - area[0] >= area[3] - area[1];
    const half = (alongX ? area[2] - area[0] : area[3] - area[1]) * 0.22;
    // The bench's front: the module's +z turned with it (benches in the square face the fountain).
    const facing = headingFor(rotateXZ(0, 1, prop.rot));
    for (const [suffix, s] of [["a", -1], ["b", 1]] as const) {
      seats.push({
        id: `bench-${bench}${suffix}`,
        space: "town",
        pos: alongX ? [cx + s * half, cz] : [cx, cz + s * half],
        facing,
        labelKey: propLabelKey("bench"),
      });
    }
    bench++;
  }
  const cafe = interiorLayout("cafe");
  const tables = cafe.furniture.filter((p) => p.module === "table").map((p) => centre(pieceArea(p)));
  let chair = 0;
  for (const piece of cafe.furniture) {
    if (piece.module !== "chair") continue;
    const pos = centre(pieceArea(piece));
    // A café chair faces its table.
    const table = tables.reduce((best, t) => (Math.hypot(t[0] - pos[0], t[1] - pos[1]) < Math.hypot(best[0] - pos[0], best[1] - pos[1]) ? t : best), tables[0] ?? pos);
    seats.push({ id: `cafe-chair-${chair++}`, space: "cafe", pos, facing: headingFor([table[0] - pos[0], table[1] - pos[1]]), labelKey: furnitureLabelKey("chair") });
  }
  return seats;
}

let cache: readonly Seat[] | undefined;

/** Every seat in the game. */
export function allSeats(): readonly Seat[] {
  cache ??= buildSeats();
  return cache;
}

export function spaceSeats(space: SpaceId): Seat[] {
  return allSeats().filter((s) => s.space === space);
}

export function getSeat(id: string): Seat | undefined {
  return allSeats().find((s) => s.id === id);
}

/** The nearest seat within `reach` of `pos` in `space`, or null. */
export function nearestSeat(space: SpaceId, pos: Vec2, reach = SEAT_REACH_M): Seat | null {
  let best: { d: number; seat: Seat } | null = null;
  for (const seat of spaceSeats(space)) {
    const d = Math.hypot(pos[0] - seat.pos[0], pos[1] - seat.pos[1]);
    if (d <= reach && (!best || d < best.d)) best = { d, seat };
  }
  return best?.seat ?? null;
}

export type SitRefusal = "unknown_seat" | "too_far" | "taken" | "busy";

/** Judges `seat:sit` against the server's walker and who else sits where. */
export function judgeSit(seatId: string, space: SpaceId, pos: Vec2, taken: boolean, busy: boolean): { ok: true; seat: Seat } | { ok: false; reason: SitRefusal } {
  const seat = getSeat(seatId);
  if (!seat || seat.space !== space) return { ok: false, reason: "unknown_seat" };
  if (busy) return { ok: false, reason: "busy" };
  if (Math.hypot(pos[0] - seat.pos[0], pos[1] - seat.pos[1]) > SEAT_REACH_M + SEAT_SLACK_M) return { ok: false, reason: "too_far" };
  if (taken) return { ok: false, reason: "taken" };
  return { ok: true, seat };
}
