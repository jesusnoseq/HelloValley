import type { Vec3 } from "../buildings/assemble";
import { NPC_IDS, type NpcId } from "../data/npcs";
import { type InteriorId } from "./interiors";
import { headingFor } from "./movement";
import { rayBox, type SpaceId } from "./player";
import type { Vec2 } from "./town";

/**
 * Where the villagers stand (build plan M23). For now every NPC stays at one post inside their
 * workplace (or home): the shop NPCs behind their counter, the others at a spot in their room.
 * TODO(M31): NPCs follow their schedules (shared `schedulePointAt`), the server walks them and
 * syncs their positions in the TownRoom state; these posts become the "work" points.
 * TODO(M31): NPC bodies block the walkability grid (the player can walk through them for now).
 *
 * Pure data in the interior frame (metres, see interiors.ts), so the server checks the same
 * distances: `npc:start` needs the player within NPC_TALK_RADIUS_M (plus a little slack), and a
 * conversation ends when they walk further than NPC_WALK_AWAY_M or leave the room.
 */

export interface NpcPost {
  npcId: NpcId;
  space: InteriorId;
  /** Where the NPC stands. */
  pos: Vec2;
  /** The NPC's resting heading (three.js rotation.y). */
  facing: number;
  /** Where a click on the NPC walks the player to (in front of the counter or desk). */
  talkSpot: Vec2;
}

/** You can talk to an NPC within this distance of where they stand (metres, my number). */
export const NPC_TALK_RADIUS_M = 2;
/** A conversation ends when the player is further than this from the NPC (walked away). */
export const NPC_WALK_AWAY_M = 3.5;
/** Extra reach the server allows for `npc:start` (position reports lag the client a little). */
export const NPC_TALK_SLACK_M = 0.5;
/** Pick box of an NPC for a click: half its width and its height (metres). */
export const NPC_PICK_HALF_M = 0.4;
export const NPC_PICK_HEIGHT_M = 1.7;

const SOUTH = headingFor([0, 1]);

const post = (npcId: NpcId, space: InteriorId, pos: Vec2, talkSpot: Vec2, facing = SOUTH): NpcPost => ({ npcId, space, pos, facing, talkSpot });

/** One post per NPC; the shop counters match the interior `vendor` and `counter` / `desk` spots. */
export const NPC_POSTS: Readonly<Record<NpcId, NpcPost>> = {
  shopkeeper: post("shopkeeper", "general_store", [3.5, 1.25], [3.5, 2.9]),
  baker: post("baker", "bakery", [3, 1.25], [3, 2.9]),
  barista: post("barista", "cafe", [2, 0.75], [2, 2.4]),
  farmer: post("farmer", "farm", [3.5, 2.6], [3.5, 3.9]),
  mayor: post("mayor", "town_hall", [4, 1.25], [4, 2.9]),
  librarian: post("librarian", "library", [4, 0.6], [4, 2.4]),
  doctor: post("doctor", "clinic", [3.25, 0.75], [3.25, 2.4]),
  gossip: post("gossip", "gossip_house", [1.75, 1.4], [1.75, 2.7]),
  elder: post("elder", "elder_cottage", [3.5, 2.5], [3.5, 3.7]),
};

export function npcPost(npcId: NpcId): NpcPost {
  return NPC_POSTS[npcId];
}

/** The NPCs standing in a space. */
export function npcsInSpace(space: SpaceId): NpcPost[] {
  return NPC_IDS.map((id) => NPC_POSTS[id]).filter((p) => p.space === space);
}

/** Distance from `pos` to the NPC, or Infinity when the player is in another space. */
export function npcDistance(npcId: NpcId, space: SpaceId, pos: Vec2): number {
  const p = NPC_POSTS[npcId];
  if (p.space !== space) return Infinity;
  return Math.hypot(pos[0] - p.pos[0], pos[1] - p.pos[1]);
}

/** Close enough to start talking (`slack` for the server's check of lagging reports). */
export function canTalkTo(npcId: NpcId, space: SpaceId, pos: Vec2, slack = 0): boolean {
  return npcDistance(npcId, space, pos) <= NPC_TALK_RADIUS_M + slack;
}

/** The player walked away from the conversation (or left the room). */
export function walkedAway(npcId: NpcId, space: SpaceId, pos: Vec2): boolean {
  return npcDistance(npcId, space, pos) > NPC_WALK_AWAY_M;
}

/** The NPC a click ray (origin, direction) hits first in a space, or null. */
export function pickNpc(space: SpaceId, origin: Vec3, dir: Vec3): NpcId | null {
  let best: { t: number; id: NpcId } | null = null;
  for (const p of npcsInSpace(space)) {
    const h = NPC_PICK_HALF_M;
    const t = rayBox(origin, dir, [p.pos[0] - h, 0, p.pos[1] - h], [p.pos[0] + h, NPC_PICK_HEIGHT_M, p.pos[1] + h]);
    if (t !== null && (!best || t < best.t)) best = { t, id: p.npcId };
  }
  return best?.id ?? null;
}

/** The heading that looks from `from` towards `to`. */
export function headingTowards(from: Vec2, to: Vec2): number {
  return headingFor([to[0] - from[0], to[1] - from[1]]);
}
