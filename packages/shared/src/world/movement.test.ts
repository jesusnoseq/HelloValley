import { describe, expect, it } from "vitest";
import {
  circleFits,
  clampDirection,
  followPath,
  headingFor,
  MAX_MOVE_STEP_M,
  moveWithCollisions,
  type PathFollow,
  planPath,
  PLAYER_RADIUS_M,
  segmentClear,
  snapStandable,
  standableGrid,
} from "./movement";
import { createNavGrid, fillOverlapping, type NavGrid, townNavGrid } from "./navgrid";
import { SPAWN_POINT, type Vec2 } from "./town";

/** A 10 x 10 m open room with a wall from (5, 0) to (5.5, 8): the way round is at the south end. */
function room(): NavGrid {
  const g = createNavGrid(10, 10);
  g.walk.fill(1);
  fillOverlapping(g, [5, 0, 5.5, 8], 0);
  return g;
}

function walk(grid: NavGrid, from: Vec2, points: Vec2[], speed = 2, dt = 1 / 60, maxSeconds = 60): Vec2 {
  const path: PathFollow = { points, index: 0, stuck: 0 };
  let pos = from;
  for (let t = 0; t < maxSeconds; t += dt) {
    const r = followPath(grid, pos, path, speed, dt);
    expect(circleFits(grid, r.pos), `walker overlaps a wall at ${r.pos.join(", ")}`).toBe(true);
    pos = r.pos;
    if (r.done || r.stuck) break;
  }
  return pos;
}

describe("walker collisions", () => {
  it("fits a circle only clear of blocked cells and the grid edge", () => {
    const g = room();
    expect(circleFits(g, [2, 2])).toBe(true);
    expect(circleFits(g, [5 - PLAYER_RADIUS_M - 0.01, 2])).toBe(true);
    expect(circleFits(g, [5 - PLAYER_RADIUS_M + 0.01, 2])).toBe(false);
    expect(circleFits(g, [0.1, 5])).toBe(false);
    // A cell corner is a point: the circle clears it diagonally.
    expect(circleFits(g, [4.8, 8.2])).toBe(true);
    expect(circleFits(g, [4.9, 8.1])).toBe(false);
  });

  it("stops at walls and slides along them", () => {
    const g = room();
    const stopped = moveWithCollisions(g, [3, 4], [5, 0]);
    expect(stopped[0]).toBeLessThanOrEqual(5 - PLAYER_RADIUS_M);
    expect(stopped[0]).toBeGreaterThan(5 - PLAYER_RADIUS_M - MAX_MOVE_STEP_M);
    expect(stopped[1]).toBe(4);
    const slid = moveWithCollisions(g, [4.7, 4], [1, 1]);
    expect(slid[0]).toBeLessThanOrEqual(5 - PLAYER_RADIUS_M);
    expect(slid[1]).toBeCloseTo(5, 6);
  });

  it("does not tunnel through a half-metre wall on a long frame", () => {
    const g = room();
    const p = moveWithCollisions(g, [4, 4], [6, 0]);
    expect(p[0]).toBeLessThan(5);
  });

  it("lets a walker stuck in a wall walk out", () => {
    const g = room();
    const p = moveWithCollisions(g, [4.9, 4], [-1, 0]);
    expect(circleFits(g, p)).toBe(true);
  });

  it("clamps directions and turns headings like three.js rotation.y", () => {
    expect(clampDirection([3, 4])).toEqual([0.6, 0.8]);
    expect(clampDirection([0.3, 0])).toEqual([0.3, 0]);
    expect(headingFor([0, 1])).toBeCloseTo(0);
    expect(headingFor([1, 0])).toBeCloseTo(Math.PI / 2);
  });
});

describe("click-to-move paths", () => {
  it("goes round the wall with the whole circle clear", () => {
    const g = room();
    const points = planPath(g, [2, 2], [8, 2])!;
    expect(points).not.toBeNull();
    let prev: Vec2 = [2, 2];
    for (const p of points) {
      expect(segmentClear(g, prev, p)).toBe(true);
      prev = p;
    }
    expect(points.at(-1)).toEqual([8, 2]);
    const end = walk(g, [2, 2], points);
    expect(Math.hypot(end[0] - 8, end[1] - 2)).toBeLessThan(0.05);
  });

  it("walks straight when nothing is in the way, and returns [] when already there", () => {
    const g = room();
    expect(planPath(g, [1, 1], [3, 3])).toEqual([[3, 3]]);
    expect(planPath(g, [1, 1], [1, 1])).toEqual([]);
  });

  it("snaps a target inside a wall to where a walker fits", () => {
    const g = room();
    const snapped = snapStandable(g, [5.2, 4])!;
    expect(circleFits(g, snapped)).toBe(true);
    expect(Math.hypot(snapped[0] - 5.2, snapped[1] - 4)).toBeLessThan(1);
    const points = planPath(g, [2, 4], [5.2, 4])!;
    expect(points.at(-1)).toEqual(snapped);
  });

  it("returns null for unreachable targets", () => {
    const g = createNavGrid(6, 6);
    g.walk.fill(1);
    fillOverlapping(g, [3, 0, 3.5, 6], 0);
    expect(planPath(g, [1, 3], [5, 3])).toBeNull();
  });

  it("marks standable cells for the walker radius", () => {
    const g = room();
    const s = standableGrid(g);
    expect(s).toBe(standableGrid(g));
    const count = (grid: NavGrid) => grid.walk.reduce((n, v) => n + v, 0);
    // On 0.5 m cells a 0.22 m walker fits every walkable cell centre; a wider one does not.
    expect(count(s)).toBe(count(g));
    expect(count(standableGrid(g, 0.3))).toBeLessThan(count(g));
  });

  it("gives up a path that runs into a wall", () => {
    const g = room();
    const path: PathFollow = { points: [[8, 4]], index: 0, stuck: 0 };
    let pos: Vec2 = [3, 4];
    let stuck = false;
    for (let k = 0; k < 600 && !stuck; k++) {
      const r = followPath(g, pos, path, 2, 1 / 60);
      pos = r.pos;
      stuck = r.stuck;
    }
    expect(stuck).toBe(true);
  });

  it("plans town paths from the spawn point", () => {
    const g = townNavGrid();
    const points = planPath(g, SPAWN_POINT, [37, 44])!;
    expect(points).not.toBeNull();
    const end = walk(g, SPAWN_POINT, points, 4.2, 1 / 30, 120);
    expect(Math.hypot(end[0] - 37, end[1] - 44)).toBeLessThan(0.05);
  });
});
