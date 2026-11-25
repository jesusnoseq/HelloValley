import { describe, expect, it } from "vitest";
import { circleFits, moveWithCollisions, segmentClear } from "./movement";
import {
  createMoveTracker,
  doorFor,
  MOVE_BUDGET_CAP_M,
  MOVE_BUDGET_RATE_MPS,
  MOVE_PROBE_RADIUS_M,
  resetMoveTracker,
  validateMove,
} from "./moveValidation";
import { interiorArrivalPoint, PlayerController, spaceDoors, spaceGrid, type SpacePoint } from "./player";
import { buildingArea, buildingDoors, SPAWN_POINT, townBuilding, type Vec2 } from "./town";

const TOWN_START: SpacePoint = { space: "town", pos: SPAWN_POINT, heading: 0 };
const REPORT_MS = 50;
const FRAME_S = 1 / 60;

/** Walks a controller for `seconds`, reporting every 50 ms, going through doors after a 0.8 s fade. */
function walkAndReport(p: PlayerController, seconds: number, startMs: number) {
  const tracker = createMoveTracker(p.state, startMs);
  let now = startMs;
  let sinceReport = 0;
  let rejected = 0;
  let doors = 0;
  const report = () => {
    const v = validateMove(tracker, { space: p.state.space, pos: p.state.pos, heading: p.state.heading }, now);
    if (!v.ok) rejected++;
    if (v.ok && v.door) doors++;
  };
  for (let t = 0; t < seconds; t += FRAME_S) {
    now += FRAME_S * 1000;
    sinceReport += FRAME_S * 1000;
    const door = p.update(FRAME_S);
    if (door) {
      report(); // the client flushes the trigger position at once
      now += 800;
      p.completeTransition();
      report();
      sinceReport = 0;
      continue;
    }
    if (sinceReport >= REPORT_MS) {
      report();
      sinceReport = 0;
    }
  }
  return { tracker, rejected, doors };
}

describe("validateMove: honest walkers", () => {
  it("accepts every report of a walker running to the bakery, inside and back out", () => {
    const p = new PlayerController(TOWN_START);
    const door = buildingDoors(townBuilding("bakery"))[0]!;
    p.setInput([0, 0], true);
    expect(p.clickTo(door.position)).toBe(true);
    const there = walkAndReport(p, 40, 1_000_000);
    expect(there.rejected).toBe(0);
    expect(there.doors).toBe(1);
    expect(there.tracker.space).toBe("bakery");

    // Out again: walk into the interior's exit.
    expect(p.state.space).toBe("bakery");
    p.setInput([0, 0], false);
    expect(p.clickTo(spaceDoors("bakery")[0]!.centre)).toBe(true);
    const back = walkAndReport(p, 20, 2_000_000);
    expect(back.rejected).toBe(0);
    expect(back.tracker.space).toBe("town");
  });

  it("accepts WASD running that slides along walls", () => {
    const p = new PlayerController(TOWN_START);
    // Run in a few directions, including straight into buildings.
    let total = 0;
    for (const dir of [[1, 0], [0, -1], [-1, 0], [0.7, 0.7], [0, 1]] as Vec2[]) {
      p.setInput(dir, true);
      const r = walkAndReport(p, 2.5, 3_000_000 + total);
      total += 10_000;
      expect(r.rejected).toBe(0);
    }
  });
});

describe("validateMove: speed cap", () => {
  it("rejects a jump longer than the budget and keeps the tracker in place", () => {
    const tracker = createMoveTracker(TOWN_START, 0);
    const far: Vec2 = [SPAWN_POINT[0] + MOVE_BUDGET_CAP_M + 1, SPAWN_POINT[1]];
    const v = validateMove(tracker, { space: "town", pos: far, heading: 0 }, 100);
    expect(v).toEqual({ ok: false, reason: "speed" });
    expect(tracker.pos).toEqual(SPAWN_POINT);
  });

  it("rejects sustained movement faster than the run speed", () => {
    // A speed hack: twice the run speed along a clear line, reported every 100 ms.
    const tracker = createMoveTracker(TOWN_START, 0);
    let pos: Vec2 = [SPAWN_POINT[0], SPAWN_POINT[1]];
    let firstReject = -1;
    for (let k = 1; k <= 40 && firstReject < 0; k++) {
      const next = moveWithCollisions(spaceGrid("town"), pos, [MOVE_BUDGET_RATE_MPS * 2 * 0.1, 0]);
      if (next[0] === pos[0]) break; // hit something: no more speed to test
      const v = validateMove(tracker, { space: "town", pos: next, heading: 0 }, k * 100);
      if (v.ok) pos = next;
      else {
        expect(v.reason).toBe("speed");
        firstReject = k;
      }
    }
    expect(firstReject).toBeGreaterThan(0);
    // The burst allowance covers about a second before the cap bites.
    expect(firstReject).toBeLessThan(15);
  });

  it("refills the budget over time but never beyond the burst cap", () => {
    const tracker = createMoveTracker(TOWN_START, 0);
    tracker.budget = 0;
    validateMove(tracker, { space: "town", pos: SPAWN_POINT, heading: 0 }, 500);
    expect(tracker.budget).toBeCloseTo(MOVE_BUDGET_RATE_MPS * 0.5, 6);
    validateMove(tracker, { space: "town", pos: SPAWN_POINT, heading: 0 }, 60_000);
    expect(tracker.budget).toBeCloseTo(MOVE_BUDGET_CAP_M, 6);
  });
});

describe("validateMove: walkability", () => {
  it("rejects standing inside a building", () => {
    const b = townBuilding("bakery");
    const area = buildingArea(b);
    const inside: Vec2 = [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2];
    const door = buildingDoors(b)[0]!;
    const near: Vec2 = [door.position[0] + door.normal[0] * 1.2, door.position[1] + door.normal[1] * 1.2];
    const tracker = createMoveTracker({ space: "town", pos: near, heading: 0 }, 0);
    expect(circleFits(spaceGrid("town"), near)).toBe(true);
    // Far enough that the budget is not what stops it.
    tracker.budget = 1000;
    expect(validateMove(tracker, { space: "town", pos: inside, heading: 0 }, 1)).toEqual({ ok: false, reason: "blocked" });
  });

  it("rejects a hop across an obstacle even when both ends are walkable", () => {
    const grid = spaceGrid("town");
    // Find two standable points 1–3 m apart with something solid between them.
    let pair: [Vec2, Vec2] | null = null;
    outer: for (let z = 2; z < grid.d * grid.cell - 2; z += 0.5) {
      for (let x = 2; x < grid.w * grid.cell - 2; x += 0.5) {
        const a: Vec2 = [x + 0.25, z + 0.25];
        if (!circleFits(grid, a)) continue;
        for (let d = 1; d <= 3; d += 0.5) {
          const b: Vec2 = [a[0] + d, a[1]];
          if (!circleFits(grid, b) || segmentClear(grid, a, b, MOVE_PROBE_RADIUS_M)) continue;
          const slid = moveWithCollisions(grid, a, [d, 0]);
          if (Math.hypot(slid[0] - b[0], slid[1] - b[1]) < 0.5) continue;
          pair = [a, b];
          break outer;
        }
      }
    }
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    const tracker = createMoveTracker({ space: "town", pos: a, heading: 0 }, 0);
    expect(validateMove(tracker, { space: "town", pos: b, heading: 0 }, 1)).toEqual({ ok: false, reason: "blocked" });
    expect(tracker.pos).toEqual(a);
  });
});

describe("validateMove: spaces", () => {
  it("rejects entering an interior away from its door", () => {
    const tracker = createMoveTracker(TOWN_START, 0);
    const arrival = interiorArrivalPoint("bakery");
    expect(validateMove(tracker, { space: "bakery", pos: arrival.pos, heading: 0 }, 1000)).toEqual({ ok: false, reason: "space" });
  });

  it("accepts entering an interior from its door trigger, arriving at the door", () => {
    const door = buildingDoors(townBuilding("bakery"))[0]!;
    const at: Vec2 = [door.position[0] + door.normal[0] * 0.3, door.position[1] + door.normal[1] * 0.3];
    const tracker = createMoveTracker({ space: "town", pos: at, heading: 0 }, 0);
    const arrival = interiorArrivalPoint("bakery");
    expect(doorFor(tracker, { space: "bakery", pos: arrival.pos })).not.toBeNull();
    const v = validateMove(tracker, { space: "bakery", pos: arrival.pos, heading: arrival.heading }, 1000);
    expect(v.ok).toBe(true);
    expect(tracker.space).toBe("bakery");
    // Arriving far from the door's far side is not allowed.
    const t2 = createMoveTracker({ space: "town", pos: at, heading: 0 }, 0);
    const wrong: Vec2 = [arrival.pos[0] + 2, arrival.pos[1]];
    expect(validateMove(t2, { space: "bakery", pos: wrong, heading: 0 }, 1000)).toEqual({ ok: false, reason: "space" });
  });

  it("resetMoveTracker teleports and refills", () => {
    const tracker = createMoveTracker(TOWN_START, 0);
    tracker.budget = 0;
    const home = interiorArrivalPoint("apartment");
    resetMoveTracker(tracker, home, 50);
    expect(tracker).toMatchObject({ space: "apartment", pos: home.pos, budget: MOVE_BUDGET_CAP_M, lastMs: 50 });
  });

  it("rejects non-finite positions", () => {
    const tracker = createMoveTracker(TOWN_START, 0);
    expect(validateMove(tracker, { space: "town", pos: [Number.NaN, 0], heading: 0 }, 1).ok).toBe(false);
  });
});
