import type { Vec3 } from "../buildings/assemble";
import { NPC_IDS, type NpcId } from "../data/npcs";
import { type InteriorId } from "./interiors";
import { headingFor } from "./movement";
import { rayBox, type SpaceId } from "./player";
import type { Vec2 } from "./town";

/**
 * Where the villagers stand (build plan M23). Every NPC has one post inside their workplace (or
 * home): the shop NPCs behind their counter, the others at a spot in their room. Since build plan
 * M31 the server walks the NPCs along their schedules (npc/life.ts) and syncs where they are; the
 * posts are their "work" (and sleep) points, and where they stand when no NPC life runs (offline,
 * the dev pages, room tests).
 *
 * The distance helpers take an `NpcLocator` (where each NPC is right now); the default is the
 * posts. The server checks the same distances: `npc:start` needs the player within
 * NPC_TALK_RADIUS_M (plus a little slack), and a conversation ends when they walk further than
 * NPC_WALK_AWAY_M or leave the room. NPC bodies do not block the walkability grid (players and
 * NPCs walk through each other, like players do).
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

/** Where an NPC is right now: its space, position and heading (build plan M31). */
export interface NpcWhere {
  npcId: NpcId;
  space: SpaceId;
  pos: Vec2;
  facing: number;
}

/** Where each NPC is: the live positions (server simulation, synced room state) or the posts. */
export type NpcLocator = (npcId: NpcId) => NpcWhere;

/** The NPCs at their posts (no NPC life). */
export const postLocator: NpcLocator = (npcId) => NPC_POSTS[npcId];

/** The NPCs standing in a space. */
export function npcsInSpace(space: SpaceId, locate: NpcLocator = postLocator): NpcWhere[] {
  return NPC_IDS.map((id) => locate(id)).filter((p) => p.space === space);
}

/** Distance from `pos` to the NPC, or Infinity when the player is in another space. */
export function npcDistance(npcId: NpcId, space: SpaceId, pos: Vec2, locate: NpcLocator = postLocator): number {
  const p = locate(npcId);
  if (p.space !== space) return Infinity;
  return Math.hypot(pos[0] - p.pos[0], pos[1] - p.pos[1]);
}

/** Close enough to start talking (`slack` for the server's check of lagging reports). */
export function canTalkTo(npcId: NpcId, space: SpaceId, pos: Vec2, slack = 0, locate: NpcLocator = postLocator): boolean {
  return npcDistance(npcId, space, pos, locate) <= NPC_TALK_RADIUS_M + slack;
}

/** The player walked away from the conversation (or left the room). */
export function walkedAway(npcId: NpcId, space: SpaceId, pos: Vec2, locate: NpcLocator = postLocator): boolean {
  return npcDistance(npcId, space, pos, locate) > NPC_WALK_AWAY_M;
}

/**
 * Where a click on an NPC walks the player: the post's talk spot when the NPC is at its post,
 * otherwise a point TALK_APPROACH_M in front of the NPC, on the player's side.
 */
export function talkSpotFor(where: NpcWhere, from: Vec2): Vec2 {
  const post = NPC_POSTS[where.npcId];
  if (post.space === where.space && Math.hypot(post.pos[0] - where.pos[0], post.pos[1] - where.pos[1]) < 0.05) return post.talkSpot;
  const dx = from[0] - where.pos[0];
  const dz = from[1] - where.pos[1];
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return [where.pos[0], where.pos[1]];
  return [where.pos[0] + (dx / d) * TALK_APPROACH_M, where.pos[1] + (dz / d) * TALK_APPROACH_M];
}

/** How far in front of a walking (or visiting) NPC a click puts the player (metres). */
export const TALK_APPROACH_M = 1.2;

/** The NPC a click ray (origin, direction) hits first in a space, or null. */
export function pickNpc(space: SpaceId, origin: Vec3, dir: Vec3, locate: NpcLocator = postLocator): NpcId | null {
  let best: { t: number; id: NpcId } | null = null;
  for (const p of npcsInSpace(space, locate)) {
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
