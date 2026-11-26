import { circleFits, moveWithCollisions, RUN_SPEED_MPS, segmentClear } from "./movement";
import { cellOf, isWalkableCell } from "./navgrid";
import { type DoorLink, type SpaceGrids, type SpaceId, spaceDoors, spaceGrid, type SpacePoint } from "./player";
import type { Area, Vec2 } from "./town";

/**
 * Server-side movement validation (build plan M16). The client predicts its own walker with the
 * shared PlayerController and reports where it is; the server checks every report against the
 * same walkability grids and a speed cap before anyone else sees it:
 *
 * - **Speed**: a distance budget refills at `RUN_SPEED_MPS × MOVE_SPEED_TOLERANCE` per second of
 *   server time, up to `MOVE_BURST_S` seconds' worth (network jitter delivers reports in bunches).
 *   Each accepted report spends the distance it covers.
 * - **Walkability**: the reported point must hold a walker (the same rule moveWithCollisions
 *   applies), and the straight segment from the last accepted point must not cross a blocked
 *   cell, unless a collision-sliding step from the last point lands next to it (walls bend paths).
 * - **Spaces**: changing space is only possible through a door of the current space whose trigger
 *   zone the walker was at, arriving next to that door's far side.
 *
 * A rejected report leaves the tracker unchanged; the server corrects the client to it.
 * Build plan M29: a walk-speed buff (bread) raises the refill rate and the cap by the tracker's
 * `speedFactor`, the same factor the client's PlayerController walks with.
 */

/** Allowed speed over the run speed (frame timing, float error). */
export const MOVE_SPEED_TOLERANCE = 1.15;
/** Seconds of movement budget that can pile up while reports are delayed. */
export const MOVE_BURST_S = 1;
/** Extra metres always allowed on top of the budget. */
export const MOVE_SLACK_M = 0.25;
/** Radius of the segment probe between two reports (thin: only stops passing through walls). */
export const MOVE_PROBE_RADIUS_M = 0.05;
/** A sliding step may end this far from the reported point. */
export const MOVE_SLIDE_TOLERANCE_M = 0.2;
/** To use a door, the last accepted point must be this close to its trigger zone. */
export const DOOR_REACH_M = 0.6;
/** After a door, the reported point must be this close to the door's arrival point. */
export const DOOR_ARRIVAL_REACH_M = 0.75;

export const MOVE_BUDGET_RATE_MPS = RUN_SPEED_MPS * MOVE_SPEED_TOLERANCE;
export const MOVE_BUDGET_CAP_M = MOVE_BUDGET_RATE_MPS * MOVE_BURST_S + MOVE_SLACK_M;

export interface MoveTracker {
  space: SpaceId;
  pos: Vec2;
  heading: number;
  /** Metres the walker may still cover right now. */
  budget: number;
  /** Server time (ms) of the last refill. */
  lastMs: number;
  /** Speed multiplier from buffs (1 without; build plan M29). The server sets it before each check. */
  speedFactor?: number;
}

export interface MoveClaim {
  space: SpaceId;
  pos: Vec2;
  heading: number;
}

export type MoveRejection = "speed" | "blocked" | "space";
export type MoveVerdict = { ok: true; door: DoorLink | null } | { ok: false; reason: MoveRejection };

export function createMoveTracker(start: SpacePoint, nowMs: number): MoveTracker {
  return { space: start.space, pos: [start.pos[0], start.pos[1]], heading: start.heading, budget: MOVE_BUDGET_CAP_M, lastMs: nowMs };
}

/** Puts the tracker somewhere (spawn, a server teleport). The budget refills. */
export function resetMoveTracker(tracker: MoveTracker, point: SpacePoint, nowMs: number): void {
  tracker.space = point.space;
  tracker.pos = [point.pos[0], point.pos[1]];
  tracker.heading = point.heading;
  tracker.budget = MOVE_BUDGET_CAP_M * trackerSpeedFactor(tracker);
  tracker.lastMs = nowMs;
}

/** The tracker's speed multiplier, kept to a sane range (a bad value never grants more than 1.5×). */
export function trackerSpeedFactor(tracker: Pick<MoveTracker, "speedFactor">): number {
  const f = tracker.speedFactor ?? 1;
  return Number.isFinite(f) ? Math.min(1.5, Math.max(1, f)) : 1;
}

function refill(tracker: MoveTracker, nowMs: number): void {
  const dt = Math.max(0, nowMs - tracker.lastMs) / 1000;
  const f = trackerSpeedFactor(tracker);
  tracker.budget = Math.min(MOVE_BUDGET_CAP_M * f, tracker.budget + dt * MOVE_BUDGET_RATE_MPS * f);
  tracker.lastMs = Math.max(tracker.lastMs, nowMs);
}

function distanceToArea(p: Vec2, a: Area): number {
  const dx = Math.max(a[0] - p[0], 0, p[0] - a[2]);
  const dz = Math.max(a[1] - p[1], 0, p[1] - a[3]);
  return Math.hypot(dx, dz);
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Whether a walker may stand at `p`, coming from `from` (moveWithCollisions' rule). */
export function standable(space: SpaceId, from: Vec2, p: Vec2, grids: SpaceGrids = spaceGrid): boolean {
  const grid = grids(space);
  if (circleFits(grid, p)) return true;
  // A walker that was already overlapping a blocked cell may move anywhere walkable to get free.
  return !circleFits(grid, from) && isWalkableCell(grid, ...cellOf(grid, p));
}

/** Whether the walk from `from` to `to` in one space is plausible on the walkability grid. */
export function reachableStep(space: SpaceId, from: Vec2, to: Vec2, grids: SpaceGrids = spaceGrid): boolean {
  if (!standable(space, from, to, grids)) return false;
  const grid = grids(space);
  if (segmentClear(grid, from, to, MOVE_PROBE_RADIUS_M)) return true;
  const slid = moveWithCollisions(grid, from, [to[0] - from[0], to[1] - from[1]]);
  return dist(slid, to) <= MOVE_SLIDE_TOLERANCE_M;
}

/** The door of `tracker.space` that leads to `claim.space` and that the walker could have used. */
export function doorFor(tracker: Pick<MoveTracker, "space" | "pos">, claim: Pick<MoveClaim, "space" | "pos">): DoorLink | null {
  for (const door of spaceDoors(tracker.space)) {
    if (door.to.space !== claim.space) continue;
    if (distanceToArea(tracker.pos, door.trigger) > DOOR_REACH_M) continue;
    if (dist(claim.pos, door.to.pos) > DOOR_ARRIVAL_REACH_M) continue;
    return door;
  }
  return null;
}

/**
 * Validates one position report at server time `nowMs`. Accepted reports move the tracker;
 * rejected ones leave it where it was (the budget still refills). `grids` gives each space's
 * walkability (the apartment's depends on whose apartment it is, build plan M17).
 */
export function validateMove(tracker: MoveTracker, claim: MoveClaim, nowMs: number, grids: SpaceGrids = spaceGrid): MoveVerdict {
  refill(tracker, nowMs);
  if (![claim.pos[0], claim.pos[1], claim.heading].every(Number.isFinite)) return { ok: false, reason: "blocked" };

  if (claim.space !== tracker.space) {
    const door = doorFor(tracker, claim);
    if (!door) return { ok: false, reason: "space" };
    if (!standable(claim.space, door.to.pos, claim.pos, grids)) return { ok: false, reason: "blocked" };
    tracker.space = claim.space;
    tracker.pos = [claim.pos[0], claim.pos[1]];
    tracker.heading = claim.heading;
    return { ok: true, door };
  }

  const d = dist(tracker.pos, claim.pos);
  if (d > tracker.budget + 1e-6) return { ok: false, reason: "speed" };
  if (d > 1e-9 && !reachableStep(claim.space, tracker.pos, claim.pos, grids)) return { ok: false, reason: "blocked" };
  tracker.budget -= d;
  tracker.pos = [claim.pos[0], claim.pos[1]];
  tracker.heading = claim.heading;
  return { ok: true, door: null };
}
