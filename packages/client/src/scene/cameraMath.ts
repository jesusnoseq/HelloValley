/**
 * Pure camera math for the isometric diorama (GDD §7.1): an orthographic camera at about 35° pitch
 * and 45° yaw that rotates in 90° steps (Q/E) and zooms between three levels (scroll wheel), with
 * frame-rate independent easing. No three.js here so it can be unit tested in Node.
 */

export const CAMERA_PITCH_DEG = 35;
export const CAMERA_BASE_YAW_DEG = 45;
export const ROTATION_STEP_DEG = 90;
/** Facings per full turn (360 / 90). */
export const FACINGS = 4;

/**
 * Distance from the look-at target to the camera. An orthographic camera's size does not depend on
 * it; it only has to keep the whole diorama between the near and far planes.
 */
export const CAMERA_DISTANCE = 60;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 200;

export interface ZoomLevel {
  id: "near" | "mid" | "far";
  /** World metres visible from the bottom to the top of the canvas. */
  viewHeight: number;
}

/** Three zoom levels, nearest first. A building (2–5 storeys at 3 m) fills "near". */
export const ZOOM_LEVELS: readonly ZoomLevel[] = [
  { id: "near", viewHeight: 11 },
  { id: "mid", viewHeight: 19 },
  { id: "far", viewHeight: 32 },
];
export const DEFAULT_ZOOM_LEVEL = 1;

/** Easing rates in 1/s for `damp`: higher settles faster (about 99 % after 4.6 / rate seconds). */
export const ROTATION_DAMPING = 7;
export const ZOOM_DAMPING = 8;
/** Longest frame step fed to the easing, so a backgrounded tab does not snap the camera. */
export const MAX_EASING_DT = 0.1;

const DEG = Math.PI / 180;

export function degToRad(deg: number): number {
  return deg * DEG;
}

/**
 * Camera yaw in radians for a rotation step. Steps are not wrapped: easing towards an unwrapped
 * target always turns the short way (one step = one 90° turn), even across 360°.
 */
export function yawForStep(step: number): number {
  return degToRad(CAMERA_BASE_YAW_DEG + step * ROTATION_STEP_DEG);
}

/** Which of the four facings (0–3) a step points at. */
export function facingForStep(step: number): number {
  return ((step % FACINGS) + FACINGS) % FACINGS;
}

/** The zoom level after one wheel notch towards `direction` (-1 = closer, +1 = further), clamped. */
export function stepZoomLevel(level: number, direction: number, count = ZOOM_LEVELS.length): number {
  const next = Math.round(level) + Math.sign(direction);
  return Math.min(count - 1, Math.max(0, next));
}

/**
 * Camera position relative to its look-at target for a yaw and pitch (radians). Yaw 0 looks along
 * -Z from +Z; positive yaw turns the camera counter-clockwise seen from above.
 */
export function cameraOffset(yaw: number, pitch: number, distance = CAMERA_DISTANCE): [number, number, number] {
  const horizontal = distance * Math.cos(pitch);
  return [horizontal * Math.sin(yaw), distance * Math.sin(pitch), horizontal * Math.cos(yaw)];
}

/**
 * Exponential easing: moves `current` towards `target` by the fraction `1 - e^(-rate·dt)`.
 * Frame-rate independent (two half steps equal one full step) and never overshoots.
 */
export function damp(current: number, target: number, rate: number, dt: number): number {
  const step = Math.min(Math.max(dt, 0), MAX_EASING_DT);
  return target + (current - target) * Math.exp(-rate * step);
}

/**
 * `damp` in log space, for scale-like values (zoom): each frame covers the same *ratio*, so zooming
 * from 11 m to 19 m feels as fast as from 19 m to 32 m. Inputs must be positive.
 */
export function dampLog(current: number, target: number, rate: number, dt: number): number {
  return Math.exp(damp(Math.log(current), Math.log(target), rate, dt));
}

/** Snaps `current` onto `target` once it is within `epsilon`, so easing ends exactly. */
export function settle(current: number, target: number, epsilon: number): number {
  return Math.abs(current - target) <= epsilon ? target : current;
}

/**
 * Orthographic zoom for a visible world height. React Three Fiber sizes the orthographic frustum
 * in canvas pixels, so `zoom` is pixels per world metre.
 */
export function orthoZoom(viewHeight: number, canvasHeightPx: number): number {
  return Math.max(1, canvasHeightPx) / viewHeight;
}

export interface WheelStepperOptions {
  /** Accumulated |deltaY| (pixels) that counts as one notch. A mouse notch is about 100. */
  threshold?: number;
  /** Seconds after a step during which further wheel input is swallowed (trackpad inertia). */
  cooldown?: number;
}

/**
 * Turns a stream of wheel events into discrete zoom steps: a mouse notch is one step, and a long
 * trackpad swipe is one step instead of jumping straight through all three levels.
 */
export class WheelStepper {
  private readonly threshold: number;
  private readonly cooldown: number;
  private accumulated = 0;
  private blockedUntil = -Infinity;

  constructor({ threshold = 40, cooldown = 0.3 }: WheelStepperOptions = {}) {
    this.threshold = threshold;
    this.cooldown = cooldown;
  }

  /** Feeds one wheel event at time `now` (seconds). Returns -1 (zoom in), +1 (out) or 0. */
  push(deltaY: number, now: number): -1 | 0 | 1 {
    if (now < this.blockedUntil) return 0;
    if (Math.sign(deltaY) !== Math.sign(this.accumulated)) this.accumulated = 0;
    this.accumulated += deltaY;
    if (Math.abs(this.accumulated) < this.threshold) return 0;
    const direction = this.accumulated > 0 ? 1 : -1;
    this.accumulated = 0;
    this.blockedUntil = now + this.cooldown;
    return direction;
  }
}
