import { describe, expect, it } from "vitest";
import {
  CAMERA_DISTANCE,
  CAMERA_FAR,
  CAMERA_NEAR,
  CAMERA_PITCH_DEG,
  cameraOffset,
  damp,
  dampLog,
  DEFAULT_ZOOM_LEVEL,
  degToRad,
  facingForStep,
  MAX_EASING_DT,
  orthoZoom,
  settle,
  stepZoomLevel,
  WheelStepper,
  yawForStep,
  ZOOM_LEVELS,
} from "./cameraMath";

describe("rotation steps", () => {
  it("starts at the 45° isometric yaw and turns 90° per step", () => {
    expect(yawForStep(0)).toBeCloseTo(degToRad(45));
    expect(yawForStep(1) - yawForStep(0)).toBeCloseTo(Math.PI / 2);
    expect(yawForStep(-1)).toBeCloseTo(degToRad(-45));
  });

  it("keeps steps unwrapped so the camera always turns the short way", () => {
    // From step 3 to step 4 is one 90° turn, not a 270° turn back.
    expect(yawForStep(4) - yawForStep(3)).toBeCloseTo(Math.PI / 2);
    expect(facingForStep(4)).toBe(0);
    expect(facingForStep(-1)).toBe(3);
    expect(facingForStep(7)).toBe(3);
  });
});

describe("zoom levels", () => {
  it("has three levels ordered near to far, defaulting to the middle", () => {
    expect(ZOOM_LEVELS).toHaveLength(3);
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      expect(ZOOM_LEVELS[i]!.viewHeight).toBeGreaterThan(ZOOM_LEVELS[i - 1]!.viewHeight);
    }
    expect(DEFAULT_ZOOM_LEVEL).toBe(1);
  });

  it("steps one level per notch and clamps at both ends", () => {
    expect(stepZoomLevel(1, -1)).toBe(0);
    expect(stepZoomLevel(1, 1)).toBe(2);
    expect(stepZoomLevel(0, -1)).toBe(0);
    expect(stepZoomLevel(2, 1)).toBe(2);
    expect(stepZoomLevel(1, 250)).toBe(2);
    expect(stepZoomLevel(1, 0)).toBe(1);
  });

  it("converts a visible height into pixels per metre", () => {
    expect(orthoZoom(20, 1080)).toBeCloseTo(54);
    expect(orthoZoom(10, 0)).toBeCloseTo(0.1);
  });
});

describe("cameraOffset", () => {
  it("places the camera at the requested distance, pitch and yaw", () => {
    const pitch = degToRad(CAMERA_PITCH_DEG);
    const [x, y, z] = cameraOffset(yawForStep(0), pitch);
    expect(Math.hypot(x, y, z)).toBeCloseTo(CAMERA_DISTANCE);
    expect(Math.atan2(y, Math.hypot(x, z))).toBeCloseTo(pitch);
    // 45° yaw: equal x and z, the classic isometric corner view.
    expect(x).toBeCloseTo(z);
    expect(x).toBeGreaterThan(0);
  });

  it("keeps the diorama within the near and far planes", () => {
    expect(CAMERA_DISTANCE - 30).toBeGreaterThan(CAMERA_NEAR);
    expect(CAMERA_DISTANCE + 30).toBeLessThan(CAMERA_FAR);
  });

  it("rotating four steps returns to the same position", () => {
    const pitch = degToRad(CAMERA_PITCH_DEG);
    const a = cameraOffset(yawForStep(0), pitch);
    const b = cameraOffset(yawForStep(4), pitch);
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v));
  });
});

describe("easing", () => {
  it("moves towards the target without overshooting", () => {
    let v = 0;
    for (let i = 0; i < 100; i++) {
      const next = damp(v, 10, 8, 1 / 60);
      expect(next).toBeGreaterThan(v);
      expect(next).toBeLessThan(10);
      v = next;
    }
    expect(v).toBeGreaterThan(9.9);
  });

  it("is frame-rate independent", () => {
    const one = damp(0, 1, 7, 1 / 30);
    const two = damp(damp(0, 1, 7, 1 / 60), 1, 7, 1 / 60);
    expect(two).toBeCloseTo(one, 10);
  });

  it("clamps long and negative frame steps", () => {
    expect(damp(0, 1, 7, 5)).toBeCloseTo(damp(0, 1, 7, MAX_EASING_DT));
    expect(damp(0, 1, 7, -1)).toBe(0);
  });

  it("eases zoom by equal ratios in log space", () => {
    const a = dampLog(11, 19, 8, 1 / 60) / 11;
    const b = dampLog(19, (19 * 19) / 11, 8, 1 / 60) / 19; // same 19/11 ratio
    expect(a).toBeCloseTo(b, 9);
    expect(dampLog(32, 11, 8, 1 / 60)).toBeLessThan(32);
  });

  it("settles onto the target within epsilon", () => {
    expect(settle(0.99995, 1, 1e-4)).toBe(1);
    expect(settle(0.9, 1, 1e-4)).toBe(0.9);
  });

  it("finishes a rotation step in under a second at 60 fps", () => {
    let yaw = yawForStep(0);
    const target = yawForStep(1);
    let frames = 0;
    while (yaw !== target && frames < 600) {
      yaw = settle(damp(yaw, target, 7, 1 / 60), target, 1e-4);
      frames++;
    }
    expect(frames).toBeLessThan(60 * 1.5);
    expect(frames).toBeGreaterThan(15); // not a snap
  });
});

describe("WheelStepper", () => {
  it("turns a mouse notch into one step in its direction", () => {
    const w = new WheelStepper();
    expect(w.push(100, 0)).toBe(1);
    expect(w.push(-100, 1)).toBe(-1);
  });

  it("accumulates small trackpad deltas and swallows inertia", () => {
    const w = new WheelStepper({ threshold: 40, cooldown: 0.3 });
    expect(w.push(10, 0)).toBe(0);
    expect(w.push(10, 0.01)).toBe(0);
    expect(w.push(25, 0.02)).toBe(1);
    // Inertia right after the step is ignored.
    expect(w.push(60, 0.1)).toBe(0);
    expect(w.push(60, 0.2)).toBe(0);
    // After the cooldown the next gesture counts again.
    expect(w.push(60, 0.5)).toBe(1);
  });

  it("resets the accumulator when the direction flips", () => {
    const w = new WheelStepper({ threshold: 40 });
    expect(w.push(30, 0)).toBe(0);
    expect(w.push(-30, 0.01)).toBe(0);
    expect(w.push(-15, 0.02)).toBe(-1);
  });
});
