import type { Rarity } from "../data/rarity";

/**
 * The bite and the timing mini-game (build plan M27, GDD §5.2: "bite → timing mini-game (keep a
 * bobber in a moving zone for 2–4 s)"), as pure functions the client runs every frame and the
 * server's timing checks are built on.
 *
 * The bite: once the fish bites, the player has BITE_WINDOW_MS to hook it (too early spooks it,
 * too late it swims off). The reel: a vertical bar (0 = bottom, 1 = top) with a zone that drifts
 * up and down; holding the button lifts the bobber, letting go lets it sink. Progress starts at
 * REEL_START_PROGRESS, fills while the bobber is in the zone (exactly `holdSeconds` of time in the
 * zone lands the fish) and drains outside it; at 0 the fish escapes.
 */

export interface ReelParams {
  /** Zone height as a fraction of the bar. */
  zoneSize: number;
  /** Zone movement speed (rad/s of its main oscillation). */
  zoneSpeed: number;
  /** Seconds in the zone that land the fish (2–4 s, GDD §5.2). */
  holdSeconds: number;
}

/** Harder fish: a smaller, faster zone held longer (my numbers within the GDD's 2–4 s). */
export const REEL_PARAMS: Readonly<Record<Rarity, ReelParams>> = {
  common: { zoneSize: 0.34, zoneSpeed: 0.9, holdSeconds: 2 },
  uncommon: { zoneSize: 0.28, zoneSpeed: 1.2, holdSeconds: 2.6 },
  rare: { zoneSize: 0.23, zoneSpeed: 1.5, holdSeconds: 3.3 },
  legendary: { zoneSize: 0.19, zoneSpeed: 1.8, holdSeconds: 4 },
};

/** Time to hook a fish after it bites (ms). */
export const BITE_WINDOW_MS: Readonly<Record<Rarity, number>> = {
  common: 1000,
  uncommon: 850,
  rare: 700,
  legendary: 550,
};

export const REEL_START_PROGRESS = 0.3;
/** Progress lost per second while the bobber is outside the zone. */
export const REEL_DRAIN_PER_S = 0.3;
/** A reel that lasts longer than this ends with the fish escaping (seconds). */
export const REEL_MAX_S = 20;
/** Bobber physics on the bar (units/s²; units/s). */
export const REEL_LIFT = 3.2;
export const REEL_GRAVITY = 2.6;
export const REEL_MAX_SPEED = 1.6;
/** Physics sub-step (s), so the result does not depend on the frame rate much. */
const REEL_STEP_S = 1 / 120;

export type HookTiming = "early" | "hooked" | "late";

/** Hooking at `msAfterBite` (negative: before the bite). */
export function hookTiming(msAfterBite: number, rarity: Rarity): HookTiming {
  if (msAfterBite < 0) return "early";
  return msAfterBite <= BITE_WINDOW_MS[rarity] ? "hooked" : "late";
}

/** The shortest possible reel for a rarity (ms): the whole hold, all of it in the zone. */
export function minReelMs(rarity: Rarity): number {
  return REEL_PARAMS[rarity].holdSeconds * 1000;
}

/** The zone's centre (0–1) at `t` seconds into the reel, deterministic per seed. */
export function zoneCentre(t: number, params: ReelParams, seed: number): number {
  const p1 = ((seed % 997) / 997) * Math.PI * 2;
  const p2 = (((seed >>> 10) % 991) / 991) * Math.PI * 2;
  const amp = (1 - params.zoneSize) / 2;
  const w = params.zoneSpeed;
  const wave = 0.65 * Math.sin(w * t + p1) + 0.35 * Math.sin(2.3 * w * t + p2);
  return 0.5 + amp * wave;
}

export function inZone(pos: number, centre: number, size: number): boolean {
  return Math.abs(pos - centre) <= size / 2;
}

export interface ReelState {
  /** Seconds since the reel started. */
  t: number;
  /** Bobber position on the bar (0–1) and its speed. */
  pos: number;
  vel: number;
  progress: number;
  /** Seconds spent in the zone. */
  inZoneS: number;
  outcome: "caught" | "escaped" | null;
}

/** A reel starts with the bobber in the middle of the zone. */
export function startReel(params: ReelParams, seed: number): ReelState {
  return { t: 0, pos: zoneCentre(0, params, seed), vel: 0, progress: REEL_START_PROGRESS, inZoneS: 0, outcome: null };
}

/** Advances the reel by `dt` seconds with the button held (`reeling`) or not. A finished reel does not change. */
export function stepReel(state: ReelState, reeling: boolean, dt: number, params: ReelParams, seed: number): ReelState {
  if (state.outcome) return state;
  let { t, pos, vel, progress, inZoneS } = state;
  let left = Math.max(0, Number.isFinite(dt) ? Math.min(dt, 0.25) : 0);
  const gain = (1 - REEL_START_PROGRESS) / params.holdSeconds;
  while (left > 1e-9) {
    const h = Math.min(REEL_STEP_S, left);
    left -= h;
    vel += (reeling ? REEL_LIFT : -REEL_GRAVITY) * h;
    vel = Math.max(-REEL_MAX_SPEED, Math.min(REEL_MAX_SPEED, vel));
    pos += vel * h;
    if (pos <= 0 || pos >= 1) {
      pos = Math.min(1, Math.max(0, pos));
      vel = 0;
    }
    t += h;
    if (inZone(pos, zoneCentre(t, params, seed), params.zoneSize)) {
      progress += gain * h;
      inZoneS += h;
    } else progress -= REEL_DRAIN_PER_S * h;
    if (progress >= 1) return { t, pos, vel, progress: 1, inZoneS, outcome: "caught" };
    if (progress <= 0) return { t, pos, vel, progress: 0, inZoneS, outcome: "escaped" };
    if (t >= REEL_MAX_S) return { t, pos, vel, progress, inZoneS, outcome: "escaped" };
  }
  return { t, pos, vel, progress, inZoneS, outcome: null };
}

/**
 * A simple steering policy (for tests and the dev page's autoplay): hold while the bobber is
 * below the zone's centre and sinking or about to fall out. Good enough to land most fish.
 */
export function autoReel(state: ReelState, params: ReelParams, seed: number): boolean {
  const target = zoneCentre(state.t + 0.15, params, seed);
  return state.pos + state.vel * 0.25 < target;
}
