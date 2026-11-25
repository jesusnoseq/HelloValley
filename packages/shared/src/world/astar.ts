import { cellCentre, cellOf, inGrid, isWalkableCell, type NavGrid, navIndex } from "./navgrid";
import type { Vec2 } from "./town";

/**
 * A* on the walkability grid (build plan M11): 8-connected, with diagonal steps only when both
 * orthogonal neighbours are free (no cutting corners), unit cost per cell (√2 diagonally) and the
 * octile-distance heuristic, which is admissible and consistent, so paths are shortest on the
 * grid. Click-to-move (TODO(M13)) and NPC walking (TODO(M31)) use it.
 */

const SQRT2 = Math.SQRT2;
const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

function octile(di: number, dj: number): number {
  const a = Math.abs(di);
  const b = Math.abs(dj);
  return Math.max(a, b) + (SQRT2 - 1) * Math.min(a, b);
}

/** Binary min-heap of cell indices with the key they were pushed with (stale entries are skipped). */
class Heap {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];
  get size(): number {
    return this.nodes.length;
  }
  push(node: number, key: number): void {
    const { nodes, keys } = this;
    let i = nodes.length;
    nodes.push(node);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      nodes[i] = nodes[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    nodes[i] = node;
    keys[i] = key;
  }
  pop(): number {
    const { nodes, keys } = this;
    const top = nodes[0]!;
    const lastNode = nodes.pop()!;
    const lastKey = keys.pop()!;
    if (nodes.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= nodes.length) break;
        const r = l + 1;
        const c = r < nodes.length && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastKey) break;
        nodes[i] = nodes[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      nodes[i] = lastNode;
      keys[i] = lastKey;
    }
    return top;
  }
}

export interface PathCells {
  /** Cells from start to goal, inclusive, as [i, j]. */
  cells: [number, number][];
  /** Grid length in cells (diagonals count √2). */
  cost: number;
}

/** Shortest cell path between two walkable cells, or null when there is none. */
export function findCellPath(grid: NavGrid, start: [number, number], goal: [number, number], maxExpanded = grid.w * grid.d): PathCells | null {
  if (!isWalkableCell(grid, start[0], start[1]) || !isWalkableCell(grid, goal[0], goal[1])) return null;
  const n = grid.w * grid.d;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new Heap();
  const s = navIndex(grid, start[0], start[1]);
  const t = navIndex(grid, goal[0], goal[1]);
  g[s] = 0;
  heap.push(s, octile(goal[0] - start[0], goal[1] - start[1]));
  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === t) break;
    closed[cur] = 1;
    if (++expanded > maxExpanded) return null;
    const ci = cur % grid.w;
    const cj = (cur - ci) / grid.w;
    for (const [di, dj, step] of NEIGHBOURS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (!isWalkableCell(grid, ni, nj)) continue;
      if (di !== 0 && dj !== 0 && (!isWalkableCell(grid, ci + di, cj) || !isWalkableCell(grid, ci, cj + dj))) continue;
      const next = navIndex(grid, ni, nj);
      if (closed[next]) continue;
      const cost = g[cur]! + step;
      if (cost < g[next]!) {
        g[next] = cost;
        parent[next] = cur;
        heap.push(next, cost + octile(goal[0] - ni, goal[1] - nj));
      }
    }
  }
  if (g[t] === Infinity) return null;
  const cells: [number, number][] = [];
  for (let c = t; c !== -1; c = parent[c]!) cells.push([c % grid.w, Math.floor(c / grid.w)]);
  cells.reverse();
  return { cells, cost: g[t]! };
}

/**
 * Whether a straight walk from `a` to `b` (metres) stays on walkable cells. Visits every cell the
 * segment touches; passing exactly through a cell corner needs both side cells free.
 */
export function segmentWalkable(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  const x0 = a[0] / grid.cell;
  const z0 = a[1] / grid.cell;
  const x1 = b[0] / grid.cell;
  const z1 = b[1] / grid.cell;
  let i = Math.floor(x0);
  let j = Math.floor(z0);
  const iEnd = Math.floor(x1);
  const jEnd = Math.floor(z1);
  if (!isWalkableCell(grid, i, j)) return false;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const stepI = Math.sign(dx);
  const stepJ = Math.sign(dz);
  const tDeltaX = stepI !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = stepJ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepI > 0 ? (i + 1 - x0) * tDeltaX : stepI < 0 ? (x0 - i) * tDeltaX : Infinity;
  let tMaxZ = stepJ > 0 ? (j + 1 - z0) * tDeltaZ : stepJ < 0 ? (z0 - j) * tDeltaZ : Infinity;
  const limit = Math.abs(iEnd - i) + Math.abs(jEnd - j) + 2;
  for (let k = 0; k < limit; k++) {
    const t = Math.min(tMaxX, tMaxZ);
    // The next cell border lies at or past the end point: the walk ends in the current cell.
    if (t >= 1 - 1e-9) break;
    if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
      // Through a corner: both side cells must be free, then step diagonally.
      if (!isWalkableCell(grid, i + stepI, j) || !isWalkableCell(grid, i, j + stepJ)) return false;
      i += stepI;
      j += stepJ;
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      i += stepI;
      tMaxX += tDeltaX;
    } else {
      j += stepJ;
      tMaxZ += tDeltaZ;
    }
    if (!isWalkableCell(grid, i, j)) return false;
  }
  // An end point exactly on a cell border belongs to the cell `floor` gives it; it must be free too.
  return isWalkableCell(grid, iEnd, jEnd);
}

/** Drop waypoints that a straight walk can skip (greedy line-of-sight string pulling). */
export function smoothPath(grid: NavGrid, points: readonly Vec2[]): Vec2[] {
  if (points.length <= 2) return [...points];
  const out: Vec2[] = [points[0]!];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    for (let k = points.length - 1; k > anchor + 1; k--) {
      if (segmentWalkable(grid, points[anchor]!, points[k]!)) {
        next = k;
        break;
      }
    }
    out.push(points[next]!);
    anchor = next;
  }
  return out;
}

export interface FindPathOptions {
  /** Straighten the path with line-of-sight checks (default true). */
  smooth?: boolean;
  maxExpanded?: number;
}

/**
 * A walkable path in metres from `from` to `to`: `from`, then cell-centre waypoints, then `to`.
 * Null when either end is not walkable or no path exists (snap a click with `nearestWalkable`).
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2, options: FindPathOptions = {}): Vec2[] | null {
  const found = findCellPath(grid, cellOf(grid, from), cellOf(grid, to), options.maxExpanded);
  if (!found) return null;
  const points: Vec2[] = found.cells.map(([i, j]) => cellCentre(grid, i, j));
  points[0] = [from[0], from[1]];
  if (points.length === 1) points.push([to[0], to[1]]);
  else points[points.length - 1] = [to[0], to[1]];
  return options.smooth === false ? points : smoothPath(grid, points);
}

/** The walkable cell centre nearest to `p` within `maxRadiusM`, or null. */
export function nearestWalkable(grid: NavGrid, p: Vec2, maxRadiusM = 3): Vec2 | null {
  const [ci, cj] = cellOf(grid, p);
  if (isWalkableCell(grid, ci, cj)) return [p[0], p[1]];
  const rings = Math.ceil(maxRadiusM / grid.cell);
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let r = 1; r <= rings; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !isWalkableCell(grid, i, j)) continue;
        const c = cellCentre(grid, i, j);
        const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
        if (d < bestD && d <= maxRadiusM) {
          bestD = d;
          best = c;
        }
      }
    }
    // A ring further out cannot beat a hit closer than its inner radius.
    if (best && bestD <= r * grid.cell) break;
  }
  return best;
}

/** Cells reachable from `start` (8-connected, no corner cutting): 1 = reachable. */
export function reachableFrom(grid: NavGrid, start: Vec2): Uint8Array {
  const seen = new Uint8Array(grid.w * grid.d);
  const [si, sj] = cellOf(grid, start);
  if (!isWalkableCell(grid, si, sj)) return seen;
  const queue = [navIndex(grid, si, sj)];
  seen[queue[0]!] = 1;
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q]!;
    const ci = cur % grid.w;
    const cj = (cur - ci) / grid.w;
    for (const [di, dj] of NEIGHBOURS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (!inGrid(grid, ni, nj) || !isWalkableCell(grid, ni, nj)) continue;
      if (di !== 0 && dj !== 0 && (!isWalkableCell(grid, ci + di, cj) || !isWalkableCell(grid, ci, cj + dj))) continue;
      const next = navIndex(grid, ni, nj);
      if (seen[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}
