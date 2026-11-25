import { describe, expect, it } from "vitest";
import { yawForStep } from "./cameraMath";
import {
  cutawaySides,
  dampAngle,
  FADE_HOLD_MAX_S,
  type Fade,
  fadeOpacity,
  screenDirection,
  screenToWorld,
  startFade,
  stepFade,
  wrapAngle,
} from "./playerMath";

describe("player input", () => {
  it("turns held keys into a unit screen direction", () => {
    expect(screenDirection([])).toEqual([0, 0]);
    expect(screenDirection(["KeyW"])).toEqual([0, 1]);
    expect(screenDirection(["KeyW", "ArrowUp"])).toEqual([0, 1]);
    expect(screenDirection(["KeyA", "KeyD"])).toEqual([0, 0]);
    const diag = screenDirection(["KeyD", "ArrowUp", "ShiftLeft"]);
    expect(diag[0]).toBeCloseTo(Math.SQRT1_2);
    expect(diag[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it("maps screen up to walking away from the camera at every facing", () => {
    for (let step = 0; step < 4; step++) {
      const yaw = yawForStep(step);
      const cam = [Math.sin(yaw), Math.cos(yaw)];
      const up = screenToWorld([0, 1], yaw);
      expect(up[0] * cam[0]! + up[1] * cam[1]!).toBeCloseTo(-1);
      const right = screenToWorld([1, 0], yaw);
      expect(right[0] * cam[0]! + right[1] * cam[1]!).toBeCloseTo(0);
      // Right is clockwise from up seen from above (x east, z south): up x right points down (-y).
      expect(up[0] * right[1] - up[1] * right[0]).toBeCloseTo(1);
    }
    // Yaw 0 looks north (along -z): up is north, right is east.
    const n = screenToWorld([0, 1], 0);
    expect(n[0]).toBeCloseTo(0);
    expect(n[1]).toBeCloseTo(-1);
    expect(screenToWorld([1, 0], 0)[0]).toBeCloseTo(1);
  });
});

describe("interior cut-away", () => {
  it("lowers the two walls facing the camera at each 90° facing", () => {
    expect(cutawaySides(yawForStep(0)).sort()).toEqual(["east", "south"]);
    expect(cutawaySides(yawForStep(1)).sort()).toEqual(["east", "north"]);
    expect(cutawaySides(yawForStep(2)).sort()).toEqual(["north", "west"]);
    expect(cutawaySides(yawForStep(3)).sort()).toEqual(["south", "west"]);
    expect(cutawaySides(yawForStep(-1)).sort()).toEqual(["south", "west"]);
  });
});

describe("heading easing", () => {
  it("turns the short way across ±π", () => {
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI);
    expect(wrapAngle(0.5 + 4 * Math.PI)).toBeCloseTo(0.5);
    expect(wrapAngle(-0.5 - 2 * Math.PI)).toBeCloseTo(-0.5);
    const a = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, 10, 0.05);
    expect(Math.abs(a)).toBeGreaterThan(Math.PI - 0.1);
  });
});

describe("door fade", () => {
  it("fades out, swaps once, waits for the new space, then fades in", () => {
    let fade: Fade = startFade();
    let swaps = 0;
    let t = 0;
    while (fade.phase === "out") {
      const r = stepFade(fade, 1 / 60, false);
      fade = r.fade;
      swaps += r.swap ? 1 : 0;
      t += 1 / 60;
    }
    expect(swaps).toBe(1);
    expect(fade.phase).toBe("hold");
    expect(t).toBeGreaterThan(0.3);
    fade = stepFade(fade, 1 / 60, false).fade;
    expect(fade.phase).toBe("hold");
    fade = stepFade(fade, 1 / 60, true).fade;
    expect(fade.phase).toBe("in");
    for (let k = 0; k < 60; k++) fade = stepFade(fade, 1 / 60, true).fade;
    expect(fade.phase).toBe("idle");
    expect(fade.cover).toBe(0);
  });

  it("does not wait forever for a space that never loads", () => {
    let fade: Fade = { phase: "hold", cover: 1, held: 0 };
    for (let t = 0; t <= FADE_HOLD_MAX_S + 0.2; t += 0.1) fade = stepFade(fade, 0.1, false).fade;
    expect(fade.phase).not.toBe("hold");
  });

  it("eases the overlay opacity", () => {
    expect(fadeOpacity(0)).toBe(0);
    expect(fadeOpacity(1)).toBe(1);
    expect(fadeOpacity(0.5)).toBeCloseTo(0.5);
  });
});
