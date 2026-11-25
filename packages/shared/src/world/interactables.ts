import { interiorLayout } from "./interiors";
import { headingFor } from "./movement";
import type { SpaceId } from "./player";
import type { Vec2 } from "./town";

/**
 * Things the player can use with F (GDD §10) when standing next to them (build plan M15 starts
 * with the apartment mirror, which edits the avatar's appearance). Pure data from the interior
 * spots, so the server can check the same distances later.
 * TODO(M23/M25): NPCs, shop counters and labelled objects (labelKey) join this list.
 */

export type InteractableKind = "mirror";

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

let cache: Map<SpaceId, readonly Interactable[]> | undefined;

/** The interactables of a space. */
export function spaceInteractables(space: SpaceId): readonly Interactable[] {
  cache ??= new Map();
  const hit = cache.get(space);
  if (hit) return hit;
  const list: Interactable[] = [];
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
