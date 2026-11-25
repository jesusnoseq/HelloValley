import { describe, expect, it } from "vitest";
import { findCellPath, findPath, nearestWalkable, reachableFrom, segmentWalkable, smoothPath } from "./astar";
import { createNavGrid, fillCentres, fillOverlapping, isWalkable, isWalkableCell, type NavGrid, navIndex } from "./navgrid";

/** A grid from rows of `.` (walkable) and `#` (blocked), 1 m cells. */
function gridOf(rows: string[]): NavGrid {
  const grid = createNavGrid(rows[0]!.length, rows.length, 1);
  rows.forEach((row, j) => [...row].forEach((c, i) => (grid.walk[navIndex(grid, i, j)] = c === "#" ? 0 : 1)));
  return grid;
}

/** Seeded LCG for reproducible random grids. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Reference shortest distances (Dijkstra over the same moves, O(n²) and obviously correct). */
function dijkstra(grid: NavGrid, start: [number, number]): Float64Array {
  const n = grid.w * grid.d;
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  dist[navIndex(grid, ...start)] = 0;
  for (;;) {
    let cur = -1;
    for (let k = 0; k < n; k++) if (!done[k] && dist[k]! < Infinity && (cur < 0 || dist[k]! < dist[cur]!)) cur = k;
    if (cur < 0) return dist;
    done[cur] = 1;
    const i = cur % grid.w;
    const j = Math.floor(cur / grid.w);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if ((di === 0 && dj === 0) || !isWalkableCell(grid, i + di, j + dj)) continue;
        if (di !== 0 && dj !== 0 && (!isWalkableCell(grid, i + di, j) || !isWalkableCell(grid, i, j + dj))) continue;
        const k = navIndex(grid, i + di, j + dj);
        dist[k] = Math.min(dist[k]!, dist[cur]! + (di !== 0 && dj !== 0 ? Math.SQRT2 : 1));
      }
    }
  }
}

describe("A* pathfinder", () => {
  it("walks a straight corridor", () => {
    const grid = gridOf(["......"]);
    const path = findCellPath(grid, [0, 0], [5, 0]);
    expect(path?.cost).toBe(5);
    expect(path?.cells).toHaveLength(6);
  });

  it("goes around a wall and never cuts a corner", () => {
    const grid = gridOf([
      ".....", //
      ".###.",
      "...#.",
    ]);
    const path = findCellPath(grid, [0, 2], [4, 2])!;
    expect(path).not.toBeNull();
    for (let k = 1; k < path.cells.length; k++) {
      const [i0, j0] = path.cells[k - 1]!;
      const [i1, j1] = path.cells[k]!;
      expect(isWalkableCell(grid, i1, j1)).toBe(true);
      if (i0 !== i1 && j0 !== j1) {
        expect(isWalkableCell(grid, i1, j0)).toBe(true);
        expect(isWalkableCell(grid, i0, j1)).toBe(true);
      }
    }
    // Up the left side, along the top and down the right: no diagonal squeeze past the wall ends.
    expect(path.cost).toBe(8);
  });

  it("refuses a diagonal gap between two blocked cells", () => {
    const grid = gridOf([
      ".#", //
      "#.",
    ]);
    expect(findCellPath(grid, [0, 0], [1, 1])).toBeNull();
  });

  it("returns null when the goal is walled off or blocked", () => {
    const grid = gridOf([
      "..#..", //
      "..#..",
      "..#..",
    ]);
    expect(findCellPath(grid, [0, 0], [4, 0])).toBeNull();
    expect(findCellPath(grid, [0, 0], [2, 0])).toBeNull();
    expect(findPath(grid, [0.5, 0.5], [4.5, 2.5])).toBeNull();
  });

  it("finds shortest paths (matches Dijkstra on random grids)", () => {
    const random = rng(42);
    for (let trial = 0; trial < 25; trial++) {
      const grid = createNavGrid(14, 11, 1);
      for (let k = 0; k < grid.walk.length; k++) grid.walk[k] = random() < 0.28 ? 0 : 1;
      grid.walk[0] = 1;
      const dist = dijkstra(grid, [0, 0]);
      for (let k = 0; k < grid.walk.length; k++) {
        const goal: [number, number] = [k % grid.w, Math.floor(k / grid.w)];
        const found = findCellPath(grid, [0, 0], goal);
        if (dist[k] === Infinity) expect(found).toBeNull();
        else expect(found?.cost).toBeCloseTo(dist[k]!, 9);
      }
    }
  });

  it("smooths a path into straight walkable segments that start and end at the exact points", () => {
    const grid = gridOf([
      "..........", //
      "..........",
      "....##....",
      "....##....",
      "..........",
    ]);
    const from: [number, number] = [0.3, 2.6];
    const to: [number, number] = [9.7, 2.4];
    const raw = findPath(grid, from, to, { smooth: false })!;
    const smooth = findPath(grid, from, to)!;
    expect(smooth[0]).toEqual(from);
    expect(smooth.at(-1)).toEqual(to);
    expect(smooth.length).toBeLessThan(raw.length);
    expect(smooth.length).toBeGreaterThan(2);
    for (let k = 1; k < smooth.length; k++) expect(segmentWalkable(grid, smooth[k - 1]!, smooth[k]!)).toBe(true);
    expect(smoothPath(grid, [from])).toEqual([from]);
  });

  it("checks segments cell by cell, including exact corner crossings", () => {
    const grid = gridOf([
      ".#", //
      "..",
    ]);
    expect(segmentWalkable(grid, [0.5, 1.5], [1.5, 1.5])).toBe(true);
    expect(segmentWalkable(grid, [0.5, 0.5], [1.5, 0.5])).toBe(false);
    // Through the shared corner (1, 1): needs (1, 0) free, which is blocked.
    expect(segmentWalkable(grid, [0.5, 1.5], [1.5, 0.5])).toBe(false);
    expect(segmentWalkable(grid, [0.2, 0.2], [0.2, 1.8])).toBe(true);
  });

  it("snaps points to the nearest walkable cell", () => {
    const grid = gridOf([
      "#####", //
      "###..",
      "#####",
    ]);
    expect(nearestWalkable(grid, [3.2, 1.4])).toEqual([3.2, 1.4]);
    expect(nearestWalkable(grid, [1.5, 1.5])).toEqual([3.5, 1.5]);
    expect(nearestWalkable(grid, [0.5, 0.5], 1)).toBeNull();
  });

  it("floods the reachable area", () => {
    const grid = gridOf([
      "..#..", //
      "..#..",
    ]);
    const seen = reachableFrom(grid, [0.5, 0.5]);
    expect([...seen].reduce((a, b) => a + b, 0)).toBe(4);
    expect(reachableFrom(grid, [2.5, 0.5]).every((v) => v === 0)).toBe(true);
  });
});

describe("nav grid fills", () => {
  it("blocks every overlapped cell but opens only cells whose centre is inside", () => {
    const grid = createNavGrid(4, 4, 0.5);
    fillCentres(grid, [0.4, 0.4, 1.6, 1.6], 1);
    expect(isWalkable(grid, [0.75, 0.75])).toBe(true);
    expect(isWalkable(grid, [1.25, 1.25])).toBe(true);
    expect(isWalkable(grid, [0.25, 0.75])).toBe(false);
    expect(isWalkable(grid, [1.75, 1.25])).toBe(false);
    fillOverlapping(grid, [0.9, 0.9, 1.1, 1.1], 0);
    for (const p of [
      [0.75, 0.75],
      [1.25, 0.75],
      [0.75, 1.25],
      [1.25, 1.25],
    ] as [number, number][])
      expect(isWalkable(grid, p)).toBe(false);
    // Touching an edge exactly is not overlapping.
    const g2 = createNavGrid(2, 2, 0.5);
    g2.walk.fill(1);
    fillOverlapping(g2, [0, 0, 1, 1], 0);
    expect(isWalkable(g2, [1.25, 0.25])).toBe(true);
    expect(isWalkable(g2, [0.75, 0.75])).toBe(false);
  });
});
