import { interiorLayout } from "./interiors";
import { circleFits, headingFor } from "./movement";
import { townNavGrid } from "./navgrid";
import type { SpaceId } from "./player";
import { buildingDoors, townBuilding, type Vec2 } from "./town";
import type { NpcId } from "../data/npcs";
import { NPC_TALK_RADIUS_M, npcsInSpace } from "./npcPosts";
import { furnitureLabelKey, INTERCOM_LABEL_KEY, npcLabelKey, propLabelKey } from "./labels";
import { KITCHEN_REACH_M } from "../food/cooking";
import { NOTICE_BOARD_REACH_M, noticeBoardSpot } from "../quests/noticeBoard";

/**
 * Things the player can use with F (GDD §10) when standing next to them (build plan M15 starts
 * with the apartment mirror, which edits the avatar's appearance). Pure data from the interior
 * spots, so the server can check the same distances later.
 * Build plan M17 adds the lobby intercom in town, M23 the villagers at their posts (npcPosts.ts).
 * Build plan M25: every interactable has a `labelKey` (world labels, labels.ts).
 * Build plan M29: the apartment kitchen nook (F opens the kitchen and its recipe cards). Seats are
 * not interactables: they have their own reach (food/seats.ts).
 * Build plan M30: the Town Hall notice board (F opens today's requests).
 */

export type InteractableKind = "mirror" | "intercom" | "npc" | "kitchen" | "notice_board";

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
  /** With kind `npc`: who you talk to (the spot is where they stand). */
  npcId?: NpcId;
  /** Its world label (GDD §6.5): a key of `LABEL_REGISTRY`. */
  labelKey: string;
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
  intercom = { id: "town:intercom", kind: "intercom", space: "town", spot, facing: headingFor([-n[0], -n[1]]), radius: INTERCOM_RADIUS_M, labelKey: INTERCOM_LABEL_KEY };
  return intercom;
}

let cache: Map<SpaceId, readonly Interactable[]> | undefined;

/** The interactables of a space. */
export function spaceInteractables(space: SpaceId): readonly Interactable[] {
  cache ??= new Map();
  const hit = cache.get(space);
  if (hit) return hit;
  const list: Interactable[] = [];
  if (space === "town") {
    list.push(intercomInteractable());
    // The board stands north of its standing point, so it is faced looking north.
    list.push({ id: "town:notice_board", kind: "notice_board", space, spot: noticeBoardSpot(), facing: headingFor([0, -1]), radius: NOTICE_BOARD_REACH_M, labelKey: propLabelKey("notice_board") });
  }
  if (space === "apartment") {
    const spot = interiorLayout("apartment").spots.mirror;
    // The mirror hangs on the west wall (x = 0), so it is faced looking west.
    if (spot) list.push({ id: "apartment:mirror", kind: "mirror", space, spot, facing: headingFor([-1, 0]), radius: MIRROR_RADIUS_M, labelKey: furnitureLabelKey("mirror") });
    // The kitchen nook stands against the north wall (z = 0), so it is faced looking north.
    const kitchen = interiorLayout("apartment").spots.kitchen;
    if (kitchen) list.push({ id: "apartment:kitchen", kind: "kitchen", space, spot: kitchen, facing: headingFor([0, -1]), radius: KITCHEN_REACH_M, labelKey: furnitureLabelKey("kitchen.nook") });
  }
  for (const post of npcsInSpace(space)) {
    // You face the NPC from wherever you stand; `facing` is the NPC's own resting heading.
    list.push({ id: `npc:${post.npcId}`, kind: "npc", space, spot: post.pos, facing: post.facing, radius: NPC_TALK_RADIUS_M, npcId: post.npcId, labelKey: npcLabelKey(post.npcId) });
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
