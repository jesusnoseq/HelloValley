import type { Emote } from "../avatar/animation";
import { getNpc, NPC_IDS, NPC_RELATIONSHIPS, type NpcActivity, type NpcId, type NpcRelationshipKind, type SchedulePoint, schedulePointAt } from "../data/npcs";
import { clockToMinutes, type PlaceId } from "../data/world";
import { ELDER_DOCK_FACING, elderDockSpot } from "../fishing/spots";
import { reachableFrom } from "../world/astar";
import { buildingForInterior, type InteriorId, interiorEntrance, interiorLayout, interiorNavGrid, isInteriorId } from "../world/interiors";
import { circleFits, followPath, headingFor, type PathFollow, PLAYER_RADIUS_M, planPath, snapStandable, standableGrid } from "../world/movement";
import { cellCentre, cellOf, navIndex, townNavGrid } from "../world/navgrid";
import { headingTowards, NPC_POSTS, type NpcWhere } from "../world/npcPosts";
import { buildingExitPoint, interiorArrivalPoint, type SpaceId, type SpacePoint, spaceGrid } from "../world/player";
import { buildingDoors, townBuilding, townPlaces, type Vec2 } from "../world/town";

/**
 * NPC life (build plan M31, GDD §8.3): the villagers follow their schedules (data/npcs.ts). Each
 * schedule point names a place and an activity; this module turns it into a target (their own
 * post at work and at home, a visitor's spot inside someone else's building, a spot next to a
 * town place), plans the walk with A* (world/movement.ts `planPath`) across doors, and steps the
 * walker. It also picks idle behaviours (strolls, emotes) and which nearby pairs of villagers
 * have a relationship to bark about. Pure and deterministic given its random source, so the
 * server (rooms/npcLife.ts) simulates it and tests can walk a whole day.
 */

/** NPCs amble: a bit slower than a walking player (metres per second, my number). */
export const NPC_WALK_SPEED_MPS = 1.4;
/** An NPC's body is player-sized for path planning. */
export const NPC_RADIUS_M = PLAYER_RADIUS_M;
/** How often the server steps the NPCs (ms). */
export const NPC_TICK_MS = 200;
/** A walk that cannot be planned or gets stuck for this long ends with a hop to the target. */
export const NPC_STUCK_HOP_S = 3;

/** Where an NPC goes for one schedule point. */
export interface NpcTarget {
  npcId: NpcId;
  space: SpaceId;
  pos: Vec2;
  facing: number;
  place: PlaceId;
  activity: NpcActivity;
}

/** The index of the schedule point in effect at `minuteOfDay` (the last one before the first point of the day). */
export function scheduleIndexAt(npcId: NpcId, minuteOfDay: number): number {
  const points = getNpc(npcId).schedule;
  let current = points.length - 1;
  points.forEach((p, i) => {
    if ((clockToMinutes(p.at) ?? Infinity) <= minuteOfDay) current = i;
  });
  return current;
}

const SOUTH = headingFor([0, 1]);

/** Spots further than this from the room's posts, talk spots and door (metres). */
const VISIT_CLEARANCE_M = 1;
const VISIT_DOOR_CLEARANCE_M = 1.3;
/** Visitors stand at least this far apart. */
const VISIT_SPACING_M = 0.9;
/** Named interior spots that belong to the owner (where they serve), never given to visitors. */
const OWNER_SPOTS = new Set(["vendor", "counter", "desk"]);

const visitCache = new Map<InteriorId, Vec2[]>();

/**
 * Where visitors stand inside a room (deterministic): the room's named spots first (the café's
 * window table, the clinic's waiting corner…), then free floor nearest the room's centre, each
 * clear of the owner's post, the talk spot and the doorway, reachable from the entrance.
 */
export function visitorSpots(id: InteriorId): Vec2[] {
  const hit = visitCache.get(id);
  if (hit) return hit;
  const layout = interiorLayout(id);
  const grid = interiorNavGrid(id);
  const standable = standableGrid(grid, NPC_RADIUS_M);
  const arrival = interiorArrivalPoint(id).pos;
  const start = snapStandable(grid, arrival, NPC_RADIUS_M) ?? arrival;
  const reach = reachableFrom(standable, start);
  const reachable = (p: Vec2) => {
    const [i, j] = cellOf(standable, p);
    return i >= 0 && j >= 0 && i < standable.w && j < standable.d && reach[navIndex(standable, i, j)] === 1 && circleFits(grid, p, NPC_RADIUS_M);
  };
  const avoid: Vec2[] = [];
  for (const npcId of NPC_IDS) {
    const post = NPC_POSTS[npcId];
    if (post.space === id) avoid.push(post.pos, post.talkSpot);
  }
  const door = interiorEntrance(layout).position;
  const clear = (p: Vec2) => avoid.every((a) => Math.hypot(a[0] - p[0], a[1] - p[1]) >= VISIT_CLEARANCE_M) && Math.hypot(door[0] - p[0], door[1] - p[1]) >= VISIT_DOOR_CLEARANCE_M;
  const named = Object.entries(layout.spots)
    .filter(([key]) => !OWNER_SPOTS.has(key))
    .map(([, p]) => snapStandable(grid, p, NPC_RADIUS_M, 1))
    .filter((p): p is Vec2 => p !== null);
  const centre: Vec2 = [layout.w / 2, layout.d / 2];
  const cells: Vec2[] = [];
  for (let j = 0; j < standable.d; j++) for (let i = 0; i < standable.w; i++) if (standable.walk[navIndex(standable, i, j)] === 1) cells.push(cellCentre(standable, i, j));
  cells.sort((a, b) => Math.hypot(a[0] - centre[0], a[1] - centre[1]) - Math.hypot(b[0] - centre[0], b[1] - centre[1]) || a[0] - b[0] || a[1] - b[1]);
  const out: Vec2[] = [];
  for (const p of [...named, ...cells]) {
    if (!reachable(p) || !clear(p)) continue;
    if (out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < VISIT_SPACING_M)) continue;
    out.push(p);
    if (out.length >= NPC_IDS.length) break;
  }
  if (out.length === 0) out.push(start);
  visitCache.set(id, out);
  return out;
}

/** Around a town place, villagers stand on a small ring so they do not stack (metres). */
const TOWN_RING_M = 0.9;

/** Where an NPC stands at a town place (the Elder fishes on the dock's north end, build plan M27). */
export function townSpotFor(npcId: NpcId, place: PlaceId): { pos: Vec2; facing: number } {
  if (npcId === "elder" && place === "fishing_dock") return { pos: elderDockSpot(), facing: ELDER_DOCK_FACING };
  const base = townPlaces()[place];
  const k = NPC_IDS.indexOf(npcId);
  const a = (k / NPC_IDS.length) * Math.PI * 2;
  const ring: Vec2 = [base[0] + Math.cos(a) * TOWN_RING_M, base[1] + Math.sin(a) * TOWN_RING_M];
  const pos = snapStandable(townNavGrid(), ring, NPC_RADIUS_M) ?? snapStandable(townNavGrid(), base, NPC_RADIUS_M) ?? base;
  const d = Math.hypot(base[0] - pos[0], base[1] - pos[1]);
  return { pos, facing: d > 0.1 ? headingTowards(pos, base) : SOUTH };
}

/** The target for one schedule point. */
export function targetFor(npcId: NpcId, point: SchedulePoint): NpcTarget {
  const npc = getNpc(npcId);
  const base = { npcId, place: point.place, activity: point.activity };
  if (point.place === npc.building) {
    const post = NPC_POSTS[npcId];
    return { ...base, space: post.space, pos: post.pos, facing: post.facing };
  }
  if (isInteriorId(point.place)) {
    const spots = visitorSpots(point.place);
    const pos = spots[NPC_IDS.indexOf(npcId) % spots.length]!;
    // Visitors look at the owner (chatting over the counter), or into the room.
    const owner = NPC_IDS.map((id) => NPC_POSTS[id]).find((p) => p.space === point.place);
    const layout = interiorLayout(point.place);
    const look: Vec2 = owner ? owner.pos : [layout.w / 2, layout.d / 2];
    return { ...base, space: point.place, pos, facing: Math.hypot(look[0] - pos[0], look[1] - pos[1]) > 0.1 ? headingTowards(pos, look) : SOUTH };
  }
  return { ...base, space: "town", ...townSpotFor(npcId, point.place) };
}

/** The target in effect at `minuteOfDay`. */
export function targetAt(npcId: NpcId, minuteOfDay: number): NpcTarget {
  const point = schedulePointAt(getNpc(npcId), minuteOfDay)!;
  return targetFor(npcId, point);
}

/** One stretch of a walk inside one space; `exit` is the door it ends in (where the walker reappears). */
export interface NpcLeg {
  space: SpaceId;
  /** Waypoints after the leg's start (planPath); [] when the start is already there. */
  points: Vec2[];
  exit: SpacePoint | null;
}

/** How far inside the doorway an NPC walks before stepping out (metres). */
const DOOR_INSIDE_M = 0.25;

/**
 * The walk from `from` to `to`, across at most one exit door and one entrance door (every
 * building opens onto the town). Null when a stretch cannot be planned.
 */
export function planNpcRoute(from: { space: SpaceId; pos: Vec2 }, to: { space: SpaceId; pos: Vec2 }): NpcLeg[] | null {
  const legs: NpcLeg[] = [];
  let cur = { space: from.space, pos: from.pos };
  if (cur.space !== "town" && cur.space !== to.space) {
    const e = interiorEntrance(interiorLayout(cur.space));
    const inside: Vec2 = [e.position[0] + e.inward[0] * DOOR_INSIDE_M, e.position[1] + e.inward[1] * DOOR_INSIDE_M];
    const points = planPath(spaceGrid(cur.space), cur.pos, inside, NPC_RADIUS_M);
    if (!points) return null;
    const exit = buildingExitPoint(buildingForInterior(cur.space));
    legs.push({ space: cur.space, points, exit });
    cur = { space: "town", pos: exit.pos };
  }
  if (cur.space === "town" && to.space !== "town") {
    const door = buildingDoors(townBuilding(buildingForInterior(to.space as InteriorId)))[0]!;
    const points = planPath(townNavGrid(), cur.pos, door.approach, NPC_RADIUS_M);
    if (!points) return null;
    const arrival = interiorArrivalPoint(to.space as InteriorId);
    legs.push({ space: "town", points, exit: arrival });
    cur = { space: to.space, pos: arrival.pos };
  }
  const points = planPath(spaceGrid(cur.space), cur.pos, to.pos, NPC_RADIUS_M);
  if (!points) return null;
  legs.push({ space: cur.space, points, exit: null });
  return legs;
}

/** What the synced `activity` of an NPC says while it stands at its target (clips on the client). */
export function activityState(activity: NpcActivity): "" | "fishing" | "eating" {
  if (activity === "fish") return "fishing";
  if (activity === "eat") return "eating";
  return "";
}

/** One NPC as the server simulates it. */
export interface NpcWalker {
  npcId: NpcId;
  space: SpaceId;
  pos: Vec2;
  heading: number;
  motion: "idle" | "walk";
  /** The schedule point the target belongs to. */
  scheduleIndex: number;
  target: NpcTarget;
  /** The walk in progress (empty when standing). */
  legs: NpcLeg[];
  leg: number;
  follow: PathFollow | null;
  /** Seconds the current walk has been stuck. */
  stuck: number;
  /** Where the walk ends (the target, or a stroll point near it). */
  goal: { space: SpaceId; pos: Vec2; facing: number };
}

/** A walker standing at its schedule target for `minuteOfDay` (a fresh server: no walking at boot). */
export function placeWalker(npcId: NpcId, minuteOfDay: number): NpcWalker {
  const target = targetAt(npcId, minuteOfDay);
  return {
    npcId,
    space: target.space,
    pos: [target.pos[0], target.pos[1]],
    heading: target.facing,
    motion: "idle",
    scheduleIndex: scheduleIndexAt(npcId, minuteOfDay),
    target,
    legs: [],
    leg: 0,
    follow: null,
    stuck: 0,
    goal: { space: target.space, pos: target.pos, facing: target.facing },
  };
}

/** Is the walker standing still (no walk in progress)? */
export const walkerIdle = (w: NpcWalker) => w.legs.length === 0;

/** Is the walker standing at its schedule target (not walking, not strolling elsewhere)? */
export function atTarget(w: NpcWalker): boolean {
  return walkerIdle(w) && w.space === w.target.space && Math.hypot(w.pos[0] - w.target.pos[0], w.pos[1] - w.target.pos[1]) < 0.3;
}

/** Hops the walker to its goal (a walk that cannot be planned or got stuck). */
function hop(w: NpcWalker): void {
  w.space = w.goal.space;
  w.pos = [w.goal.pos[0], w.goal.pos[1]];
  w.heading = w.goal.facing;
  w.motion = "idle";
  w.legs = [];
  w.leg = 0;
  w.follow = null;
  w.stuck = 0;
}

/** Starts a walk to `goal` (the target, or a stroll point). Unplannable walks hop there. */
export function walkTo(w: NpcWalker, goal: { space: SpaceId; pos: Vec2; facing: number }): void {
  w.goal = { space: goal.space, pos: [goal.pos[0], goal.pos[1]], facing: goal.facing };
  w.stuck = 0;
  const legs = planNpcRoute({ space: w.space, pos: w.pos }, goal);
  if (!legs) return hop(w);
  w.legs = legs;
  w.leg = 0;
  w.follow = { points: legs[0]!.points, index: 0, stuck: 0 };
  if (legs.length === 1 && legs[0]!.points.length === 0) {
    w.legs = [];
    w.follow = null;
    w.heading = goal.facing;
    w.motion = "idle";
  }
}

/** Sends the walker to a new schedule target. */
export function retarget(w: NpcWalker, scheduleIndex: number, target: NpcTarget): void {
  w.scheduleIndex = scheduleIndex;
  w.target = target;
  walkTo(w, target);
}

export type StepResult = "standing" | "walking" | "arrived";

/**
 * Walks the walker for `dt` seconds. Doors switch its space at the end of a leg. Returns
 * "arrived" on the step that reaches the goal.
 */
export function stepWalker(w: NpcWalker, dt: number, speed = NPC_WALK_SPEED_MPS): StepResult {
  if (walkerIdle(w) || !w.follow) {
    w.motion = "idle";
    return "standing";
  }
  const leg = w.legs[w.leg]!;
  const r = followPath(spaceGrid(leg.space), w.pos, w.follow, speed, dt, NPC_RADIUS_M);
  w.pos = r.pos;
  if (r.dir[0] !== 0 || r.dir[1] !== 0) w.heading = headingFor(r.dir);
  w.stuck = r.done ? 0 : r.stuck ? w.stuck + dt : 0;
  if (w.stuck >= NPC_STUCK_HOP_S) {
    hop(w);
    return "arrived";
  }
  if (r.done && leg.exit) {
    // Through the door: the next leg starts on the next step (a door takes a moment).
    w.space = leg.exit.space;
    w.pos = [leg.exit.pos[0], leg.exit.pos[1]];
    w.heading = leg.exit.heading;
    w.leg++;
    const next = w.legs[w.leg];
    if (!next) {
      hop(w);
      return "arrived";
    }
    w.follow = { points: next.points, index: 0, stuck: 0 };
  } else if (r.done) {
    w.legs = [];
    w.leg = 0;
    w.follow = null;
    w.heading = w.goal.facing;
    w.motion = "idle";
    return "arrived";
  }
  w.motion = "walk";
  return "walking";
}

/** Where a live NPC is, for the shared distance checks (npcPosts.ts `NpcLocator`). */
export function walkerWhere(w: NpcWalker): NpcWhere {
  return { npcId: w.npcId, space: w.space, pos: w.pos, facing: w.heading };
}

// ---------------------------------------------------------------------------------------------
// Idle behaviours

/** Emotes an NPC plays now and then while standing at an activity (my choice). */
export const IDLE_EMOTES: Readonly<Record<NpcActivity, readonly Emote[]>> = {
  work: ["think", "wave"],
  eat: ["heart"],
  walk: ["wave"],
  chat: ["laugh", "wave", "clap"],
  fish: ["think"],
  read: ["think"],
  rest: ["think"],
  sleep: [],
};

/** Seconds between two idle behaviours of one NPC: 12–30 s (my numbers). */
export function idleDelayS(random: () => number): number {
  return 12 + random() * 18;
}

/** How far from its spot an NPC strolls on a "walk" (metres). */
export const STROLL_RADIUS_M = 2.5;

export type IdleAction = { kind: "emote"; emote: Emote } | { kind: "stroll"; goal: { space: SpaceId; pos: Vec2; facing: number } } | { kind: "home" } | null;

/**
 * The next idle behaviour of a standing NPC: strolling NPCs ("walk") wander around their spot
 * and come back, the others play an emote of their activity now and then.
 */
export function pickIdle(w: NpcWalker, random: () => number): IdleAction {
  const t = w.target;
  if (t.activity === "walk") {
    if (!atTarget(w)) return { kind: "home" };
    for (let k = 0; k < 6; k++) {
      const a = random() * Math.PI * 2;
      const d = 1 + random() * (STROLL_RADIUS_M - 1);
      const p: Vec2 = [t.pos[0] + Math.cos(a) * d, t.pos[1] + Math.sin(a) * d];
      const grid = spaceGrid(t.space);
      if (!circleFits(grid, p, NPC_RADIUS_M)) continue;
      return { kind: "stroll", goal: { space: t.space, pos: p, facing: headingFor([Math.cos(a), Math.sin(a)]) } };
    }
    return null;
  }
  const emotes = IDLE_EMOTES[t.activity];
  if (emotes.length === 0) return null;
  return { kind: "emote", emote: emotes[Math.floor(random() * emotes.length) % emotes.length]! };
}

// ---------------------------------------------------------------------------------------------
// Who barks with whom (ambient NPC↔NPC exchanges, GDD §8.2–8.3)

/** Two villagers this close (same space, both standing) may have an exchange (metres, my number). */
export const EXCHANGE_RADIUS_M = 4;
/** Players this close to a barking NPC (same space) see the bark (metres). */
export const BARK_HEAR_RADIUS_M = 10;
/** A seated player gets small talk from a villager standing this close (build plan M29 TODO). */
export const SEAT_SMALL_TALK_RADIUS_M = 4;

/** The relationship between two villagers (docs/hellovalley-village-npcs.md), in its listed order, or null. */
export function relationshipOf(x: NpcId, y: NpcId): { a: NpcId; b: NpcId; kind: NpcRelationshipKind; note: string } | null {
  return NPC_RELATIONSHIPS.find((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x)) ?? null;
}

/** Pairs of standing villagers close enough to talk who have a relationship, in relationship order. */
export function exchangePairs(walkers: readonly NpcWhere[]): { a: NpcId; b: NpcId }[] {
  const out: { a: NpcId; b: NpcId }[] = [];
  for (const r of NPC_RELATIONSHIPS) {
    const a = walkers.find((w) => w.npcId === r.a);
    const b = walkers.find((w) => w.npcId === r.b);
    if (!a || !b || a.space !== b.space) continue;
    if (Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) <= EXCHANGE_RADIUS_M) out.push({ a: r.a, b: r.b });
  }
  return out;
}
