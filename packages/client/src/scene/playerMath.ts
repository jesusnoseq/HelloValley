/**
 * Pure client-side helpers of the player controller (build plan M13): keyboard to screen
 * direction, screen to world direction for the current camera yaw, the door fade timeline, the
 * walls the interior cut-away lowers, and heading easing. No three.js, no shared values.
 */

export type Vec2 = [number, number];

/** Keys (KeyboardEvent.code) for each screen direction: WASD and the arrows (GDD §10). */
export const MOVE_KEYS: Readonly<Record<string, Vec2>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
export const RUN_KEYS = ["ShiftLeft", "ShiftRight"] as const;

/** Screen direction (x right, y up) of the held keys, unit length or zero. */
export function screenDirection(held: Iterable<string>): Vec2 {
  let x = 0;
  let y = 0;
  const seen = new Set<string>();
  for (const code of held) {
    const d = MOVE_KEYS[code];
    // W and ArrowUp together still count once.
    if (!d || seen.has(`${d[0]},${d[1]}`)) continue;
    seen.add(`${d[0]},${d[1]}`);
    x += d[0];
    y += d[1];
  }
  const len = Math.hypot(x, y);
  return len > 0 ? [x / len, y / len] : [0, 0];
}

/**
 * Ground-plane (x, z) direction for a screen direction under a camera at `yaw` (cameraMath:
 * the camera sits at (sin yaw, cos yaw) from its target): up walks away from the camera.
 */
export function screenToWorld(screen: Vec2, yaw: number): Vec2 {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // right = (cos, -sin), forward = (-sin, -cos)
  return [screen[0] * c - screen[1] * s, -screen[0] * s - screen[1] * c];
}

export const ROOM_SIDES = ["north", "east", "south", "west"] as const;
export type Side = (typeof ROOM_SIDES)[number];
const OUTWARD: Readonly<Record<Side, Vec2>> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/**
 * The walls the diorama cut-away lowers: those whose outside faces the camera (GDD §4.1). At the
 * default yaw (45°) that is the south and east walls; while the camera turns, a wall flips once
 * the camera has turned past it.
 */
export function cutawaySides(yaw: number): Side[] {
  const cam: Vec2 = [Math.sin(yaw), Math.cos(yaw)];
  return ROOM_SIDES.filter((side) => OUTWARD[side][0] * cam[0] + OUTWARD[side][1] * cam[1] > 1e-6);
}

/** Height of a cut-away wall as a share of the full wall: a low stub that keeps the room's outline. */
export const CUTAWAY_STUB = 0.08;

/** Wrap an angle into [-π, π). */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Turn `current` towards `target` the short way, by the fraction 1 - e^(-rate·dt). */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  const diff = wrapAngle(target - current);
  return wrapAngle(current + diff * (1 - Math.exp(-rate * Math.min(Math.max(dt, 0), 0.1))));
}

// ---------------------------------------------------------------------------------------------
// Door fade

/** Seconds to fade out and to fade back in. */
export const FADE_OUT_S = 0.35;
export const FADE_IN_S = 0.45;
/** Longest wait for the next space's meshes before fading in anyway. */
export const FADE_HOLD_MAX_S = 4;

export type FadePhase = "idle" | "out" | "hold" | "in";

export interface Fade {
  phase: FadePhase;
  /** Cover amount, 0–1. */
  cover: number;
  /** Seconds spent in "hold". */
  held: number;
}

export const IDLE_FADE: Fade = { phase: "idle", cover: 0, held: 0 };

export function startFade(): Fade {
  return { phase: "out", cover: 0, held: 0 };
}

/**
 * Advance the fade. `swap` is true on the step it becomes fully covered (switch spaces now);
 * it then holds until `ready` (the new space is drawn) and fades back in.
 */
export function stepFade(fade: Fade, dt: number, ready: boolean): { fade: Fade; swap: boolean } {
  const step = Math.min(Math.max(dt, 0), 0.1);
  switch (fade.phase) {
    case "out": {
      const cover = Math.min(1, fade.cover + step / FADE_OUT_S);
      return cover >= 1 ? { fade: { phase: "hold", cover: 1, held: 0 }, swap: true } : { fade: { ...fade, cover }, swap: false };
    }
    case "hold": {
      const held = fade.held + step;
      return ready || held >= FADE_HOLD_MAX_S ? { fade: { phase: "in", cover: 1, held }, swap: false } : { fade: { ...fade, held }, swap: false };
    }
    case "in": {
      const cover = Math.max(0, fade.cover - step / FADE_IN_S);
      return { fade: cover <= 0 ? IDLE_FADE : { ...fade, cover }, swap: false };
    }
    default:
      return { fade, swap: false };
  }
}

/** Eased cover for drawing (smoothstep). */
export function fadeOpacity(cover: number): number {
  const c = Math.min(1, Math.max(0, cover));
  return c * c * (3 - 2 * c);
}
