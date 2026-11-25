import { interiorLayout } from "./interiors";
import { circleFits, headingFor } from "./movement";
import { townNavGrid } from "./navgrid";
import type { SpaceId } from "./player";
import { buildingDoors, townBuilding, type Vec2 } from "./town";

/**
 * Things the player can use with F (GDD §10) when standing next to them (build plan M15 starts
 * with the apartment mirror, which edits the avatar's appearance). Pure data from the interior
 * spots, so the server can check the same distances later.
 * Build plan M17 adds the lobby intercom in town.
 * TODO(M23/M25): NPCs, shop counters and labelled objects (labelKey) join this list.
 */

export type InteractableKind = "mirror" | "intercom";

export interface Interactable {
  id: string;
  kind: InteractableKind;
  space: SpaceId;
  /** Where you stand to use it. */
  spot: Vec2;
  /** The heading that faces it from the spot. */
  facing: number;
  /** Usable within this distance of the spot (metres). */
  radius: number;
}

/** How close to the mirror spot the player must stand (my choice). */
export const MIRROR_RADIUS_M = 0.9;
/** How close to the lobby intercom the player must stand (my choice). */
export const INTERCOM_RADIUS_M = 1;
/** The intercom panel sits this far to the side of the apartment block's front door. */
const INTERCOM_SIDE_M = 1;
/** …and you stand this far out in front of the facade to use it. */
const INTERCOM_OUT_M = 0.9;

let intercom: Interactable | undefined;

/**
 * The lobby intercom (GDD §4.2, build plan M17): next to the apartment block's front door in town.
 * It lists the players online and rings their apartment to ask for a visit.
 */
export function intercomInteractable(): Interactable {
  if (intercom) return intercom;
  const door = buildingDoors(townBuilding("apartment_block"))[0]!;
  const n = door.normal;
  // To the right of the door as you face it (the tangent of the facade), then out in front.
  const side: Vec2 = [n[1], -n[0]];
  const candidates = [1, -1].map(
    (s): Vec2 => [
      door.position[0] + side[0] * INTERCOM_SIDE_M * s + n[0] * INTERCOM_OUT_M,
      door.position[1] + side[1] * INTERCOM_SIDE_M * s + n[1] * INTERCOM_OUT_M,
    ],
  );
  const spot = candidates.find((p) => circleFits(townNavGrid(), p)) ?? candidates[0]!;
  intercom = { id: "town:intercom", kind: "intercom", space: "town", spot, facing: headingFor([-n[0], -n[1]]), radius: INTERCOM_RADIUS_M };
  return intercom;
}

let cache: Map<SpaceId, readonly Interactable[]> | undefined;

/** The interactables of a space. */
export function spaceInteractables(space: SpaceId): readonly Interactable[] {
  cache ??= new Map();
  const hit = cache.get(space);
  if (hit) return hit;
  const list: Interactable[] = [];
  if (space === "town") list.push(intercomInteractable());
  if (space === "apartment") {
    const spot = interiorLayout("apartment").spots.mirror;
    // The mirror hangs on the west wall (x = 0), so it is faced looking west.
    if (spot) list.push({ id: "apartment:mirror", kind: "mirror", space, spot, facing: headingFor([-1, 0]), radius: MIRROR_RADIUS_M });
  }
  cache.set(space, list);
  return list;
}

/** The nearest interactable within reach of `pos` in `space`, or null. */
export function nearestInteractable(space: SpaceId, pos: Vec2): Interactable | null {
  let best: { d: number; it: Interactable } | null = null;
  for (const it of spaceInteractables(space)) {
    const d = Math.hypot(pos[0] - it.spot[0], pos[1] - it.spot[1]);
    if (d <= it.radius && (!best || d < best.d)) best = { d, it };
  }
  return best?.it ?? null;
}
