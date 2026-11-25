import { findCellPath, nearestWalkable } from "./astar";
import { cellCentre, cellOf, isWalkableCell, type NavGrid, navIndex } from "./navgrid";
import type { Vec2 } from "./town";

/**
 * Walker movement on a walkability grid (build plan M13): a circle of `PLAYER_RADIUS_M` that
 * slides along blocked cells, and click-to-move paths planned with A* for that circle. Pure and
 * headless: the client runs it every frame for the local player, and the server checks the
 * reported positions with the same grids (moveValidation.ts, build plan M16).
 */

/** Collision radius of a walker. Under half a 0.5 m cell, so cell-centre paths stay clear. */
export const PLAYER_RADIUS_M = 0.22;
/** Walking and running speeds in metres per second (GDD §10: Shift = run). */
export const WALK_SPEED_MPS = 2.2;
export const RUN_SPEED_MPS = 4.2;
/** Longest sub-step of one move, so a fast or long frame cannot tunnel through a 0.5 m cell. */
export const MAX_MOVE_STEP_M = 0.1;
/** A path waypoint counts as reached within this distance. */
export const WAYPOINT_EPS_M = 0.04;
/** Seconds with almost no progress before a path is given up. */
export const PATH_STUCK_S = 0.5;

const EPS = 1e-9;

/** Whether a circle at `p` touches no blocked cell (cells outside the grid count as blocked). */
export function circleFits(grid: NavGrid, p: Vec2, r = PLAYER_RADIUS_M): boolean {
  const c = grid.cell;
  const i0 = Math.floor((p[0] - r) / c);
  const i1 = Math.floor((p[0] + r) / c);
  const j0 = Math.floor((p[1] - r) / c);
  const j1 = Math.floor((p[1] + r) / c);
  const r2 = r * r - EPS;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (isWalkableCell(grid, i, j)) continue;
      const dx = Math.max(i * c - p[0], 0, p[0] - (i + 1) * c);
      const dz = Math.max(j * c - p[1], 0, p[1] - (j + 1) * c);
      if (dx * dx + dz * dz < r2) return false;
    }
  }
  return true;
}

/** Scale a direction down to length 1 if it is longer (stick input may be shorter). */
export function clampDirection(dir: Vec2): Vec2 {
  const len = Math.hypot(dir[0], dir[1]);
  return len > 1 ? [dir[0] / len, dir[1] / len] : [dir[0], dir[1]];
}

/** Yaw (radians about +Y) that turns a model facing +Z towards `dir` (three.js rotation.y). */
export function headingFor(dir: Vec2): number {
  return Math.atan2(dir[0], dir[1]);
}

/**
 * Move a walker by `delta` metres, sliding along walls: each sub-step tries the full step, then
 * only its x part, then only its z part. A walker that starts overlapping a blocked cell (an old
 * position, a teleport) may move anywhere whose cell is walkable until it is free again.
 */
export function moveWithCollisions(grid: NavGrid, from: Vec2, delta: Vec2, r = PLAYER_RADIUS_M): Vec2 {
  const len = Math.hypot(delta[0], delta[1]);
  if (len < EPS) return [from[0], from[1]];
  const steps = Math.max(1, Math.ceil(len / MAX_MOVE_STEP_M));
  const sx = delta[0] / steps;
  const sz = delta[1] / steps;
  let x = from[0];
  let z = from[1];
  const ok = (p: Vec2) => circleFits(grid, p, r) || (!circleFits(grid, [x, z], r) && isWalkableCell(grid, ...cellOf(grid, p)));
  for (let k = 0; k < steps; k++) {
    if (ok([x + sx, z + sz])) {
      x += sx;
      z += sz;
    } else if (sx !== 0 && ok([x + sx, z])) {
      x += sx;
    } else if (sz !== 0 && ok([x, z + sz])) {
      z += sz;
    } else {
      break;
    }
  }
  return [x, z];
}

/** Whether a circle can travel the straight segment a→b without touching blocked cells. */
export function segmentClear(grid: NavGrid, a: Vec2, b: Vec2, r = PLAYER_RADIUS_M): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / (MAX_MOVE_STEP_M * 0.5)));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!circleFits(grid, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], r)) return false;
  }
  return true;
}

const standableCache = new WeakMap<NavGrid, Map<number, NavGrid>>();

/** The cells whose centre can hold a walker of radius `r` (cached per grid; read-only). */
export function standableGrid(grid: NavGrid, r = PLAYER_RADIUS_M): NavGrid {
  let byRadius = standableCache.get(grid);
  if (!byRadius) standableCache.set(grid, (byRadius = new Map()));
  const hit = byRadius.get(r);
  if (hit) return hit;
  const out: NavGrid = { cell: grid.cell, w: grid.w, d: grid.d, walk: new Uint8Array(grid.w * grid.d) };
  for (let j = 0; j < grid.d; j++) {
    for (let i = 0; i < grid.w; i++) {
      const k = navIndex(grid, i, j);
      out.walk[k] = grid.walk[k] === 1 && circleFits(grid, cellCentre(grid, i, j), r) ? 1 : 0;
    }
  }
  byRadius.set(r, out);
  return out;
}

/** `p` when a walker fits there, else the nearest cell centre where it does (or null). */
export function snapStandable(grid: NavGrid, p: Vec2, r = PLAYER_RADIUS_M, maxRadiusM = 3): Vec2 | null {
  if (circleFits(grid, p, r)) return [p[0], p[1]];
  const standable = standableGrid(grid, r);
  const near = nearestWalkable(standable, p, maxRadiusM);
  if (!near) return null;
  return cellCentre(standable, ...cellOf(standable, near));
}

/**
 * A click-to-move path for a walker of radius `r`: A* over the cells it can stand in, then
 * line-of-sight smoothing that keeps the whole circle clear. Returns the waypoints after `from`
 * (the last one is the target, snapped to where the walker fits), [] when already there, or null
 * when the target cannot be reached.
 */
export function planPath(grid: NavGrid, from: Vec2, to: Vec2, r = PLAYER_RADIUS_M): Vec2[] | null {
  const goal = snapStandable(grid, to, r);
  if (!goal) return null;
  if (Math.hypot(goal[0] - from[0], goal[1] - from[1]) < WAYPOINT_EPS_M) return [];
  if (segmentClear(grid, from, goal, r)) return [goal];
  const standable = standableGrid(grid, r);
  const startNear = nearestWalkable(standable, from, 1.5);
  if (!startNear) return null;
  const found = findCellPath(standable, cellOf(standable, startNear), cellOf(standable, goal));
  if (!found) return null;
  const points: Vec2[] = [[from[0], from[1]], ...found.cells.map(([i, j]) => cellCentre(standable, i, j)), goal];
  // Greedy string pulling with circle clearance.
  const out: Vec2[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let k = points.length - 1; k > anchor + 1; k--) {
      if (segmentClear(grid, points[anchor]!, points[k]!, r)) {
        next = k;
        break;
      }
    }
    out.push(points[next]!);
    anchor = next;
  }
  return out;
}

export interface PathFollow {
  points: Vec2[];
  /** Index of the waypoint being walked to. */
  index: number;
  /** Seconds spent without real progress. */
  stuck: number;
}

export interface FollowResult {
  pos: Vec2;
  /** Unit direction walked towards this step ([0, 0] when done). */
  dir: Vec2;
  /** Every waypoint reached. */
  done: boolean;
  /** Gave up: blocked for PATH_STUCK_S. */
  stuck: boolean;
}

/** Walk along a path for `dt` seconds at `speed`, with collisions. Mutates `path` (index, stuck). */
export function followPath(grid: NavGrid, pos: Vec2, path: PathFollow, speed: number, dt: number, r = PLAYER_RADIUS_M): FollowResult {
  let budget = speed * dt;
  let p: Vec2 = [pos[0], pos[1]];
  let dir: Vec2 = [0, 0];
  let moved = 0;
  while (budget > EPS && path.index < path.points.length) {
    const target = path.points[path.index]!;
    const dx = target[0] - p[0];
    const dz = target[1] - p[1];
    const dist = Math.hypot(dx, dz);
    if (dist <= WAYPOINT_EPS_M) {
      path.index++;
      continue;
    }
    dir = [dx / dist, dz / dist];
    const step = Math.min(budget, dist);
    const next = moveWithCollisions(grid, p, [dir[0] * step, dir[1] * step], r);
    const got = Math.hypot(next[0] - p[0], next[1] - p[1]);
    moved += got;
    p = next;
    budget -= step;
    if (got < step * 0.5) break; // blocked: try again next frame
    if (step >= dist - EPS) path.index++;
  }
  const done = path.index >= path.points.length;
  path.stuck = !done && moved < speed * dt * 0.1 ? path.stuck + dt : 0;
  return { pos: p, dir: done ? [0, 0] : dir, done, stuck: path.stuck >= PATH_STUCK_S };
}
