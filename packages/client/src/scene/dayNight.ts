/**
 * Day/night lighting gradient driven by `worldTime` (GDD §4.3, §7.1). Pure data and math (no
 * three.js) so it can be unit tested.
 *
 * `worldTime` is the phase of the shared 40-minute day, 0–1, linear in real time
 * (architecture §3.1: `((Date.now() − EPOCH) mod 40 min) / 40 min`). The day is 30 minutes and the
 * night 10, so here phase 0 is sunrise, the day runs to 0.75 (sunset) and night fills the last
 * quarter. The phase comes from the server's wall clock and the phase → in-game clock mapping
 * lives in shared world/clock.ts (build plan M16).
 */

/** sRGB colour with channels 0–1. */
export type Rgb = readonly [number, number, number];

export interface Lighting {
  /** Unit vector from the scene towards the key light (sun by day, moon by night). */
  keyDirection: [number, number, number];
  keyColor: Rgb;
  keyIntensity: number;
  /** Hemisphere fill: cool sky from above, warm ground bounce from below. */
  skyColor: Rgb;
  groundColor: Rgb;
  fillIntensity: number;
  /** Clear colour behind the diorama. */
  background: Rgb;
  /** 0 by day, 1 at night: drives lamp and window emission (bloom picks it up). */
  nightGlow: number;
}

export const DAY_LENGTH_SECONDS = 40 * 60;
export const DAY_PHASE_END = 30 / 40;
export const SUNRISE = 0;
export const SUNSET = DAY_PHASE_END;

interface Keyframe {
  at: number;
  /** Compass angle of the key light in degrees (0 = +Z, 90 = +X). */
  azimuth: number;
  /** Height of the key light above the horizon in degrees. Kept ≥ 10 so shadows stay readable. */
  elevation: number;
  keyColor: string;
  keyIntensity: number;
  skyColor: string;
  groundColor: string;
  fillIntensity: number;
  background: string;
  nightGlow: number;
}

/**
 * Keyframes in phase order, wrapping from the last back to the first. Warm and pastel by day,
 * a cosy blue night (never black: the town must stay readable).
 */
export const LIGHTING_KEYFRAMES: readonly Keyframe[] = [
  // Sunrise: low pink-orange sun in the east, lamps fading out.
  { at: 0, azimuth: 100, elevation: 12, keyColor: "#ffb48c", keyIntensity: 1.3, skyColor: "#f6cbbd", groundColor: "#8c7b96", fillIntensity: 0.7, background: "#f2c9b8", nightGlow: 0.35 },
  // Morning.
  { at: 0.08, azimuth: 120, elevation: 34, keyColor: "#ffe3ba", keyIntensity: 2.6, skyColor: "#cde5f6", groundColor: "#b8a98d", fillIntensity: 0.95, background: "#cfe4f0", nightGlow: 0 },
  // Noon (middle of the day phase).
  { at: 0.375, azimuth: 180, elevation: 56, keyColor: "#fff2d8", keyIntensity: 3, skyColor: "#d4ebfa", groundColor: "#c3b490", fillIntensity: 1.05, background: "#d6eaf5", nightGlow: 0 },
  // Golden hour.
  { at: 0.66, azimuth: 240, elevation: 26, keyColor: "#ffcf96", keyIntensity: 2.6, skyColor: "#f2d9c2", groundColor: "#b89d82", fillIntensity: 0.9, background: "#f0dcc8", nightGlow: 0 },
  // Sunset: low red-orange sun in the west, lamps coming on.
  { at: SUNSET, azimuth: 262, elevation: 11, keyColor: "#ff9b6c", keyIntensity: 1.4, skyColor: "#e6a8a2", groundColor: "#705f80", fillIntensity: 0.65, background: "#d99c9c", nightGlow: 0.6 },
  // Night: the moon takes over as a cool key light.
  { at: 0.8, azimuth: 210, elevation: 44, keyColor: "#9fb3ff", keyIntensity: 0.85, skyColor: "#4a5d96", groundColor: "#2a2d48", fillIntensity: 0.8, background: "#1f2848", nightGlow: 1 },
  // Before dawn.
  { at: 0.95, azimuth: 150, elevation: 38, keyColor: "#aab8ff", keyIntensity: 0.8, skyColor: "#56629a", groundColor: "#2f3150", fillIntensity: 0.8, background: "#2b3459", nightGlow: 1 },
];

/** Wraps any number into the 0–1 phase. */
export function wrapWorldTime(t: number): number {
  const w = t - Math.floor(t);
  return Number.isFinite(w) ? w : 0;
}

/** Advances the phase by `dtSeconds` of real time, `timeScale` times faster than the real day. */
export function advanceWorldTime(t: number, dtSeconds: number, timeScale = 1, dayLength = DAY_LENGTH_SECONDS): number {
  return wrapWorldTime(t + (dtSeconds * timeScale) / dayLength);
}

/** True during the 10-minute night phase. */
export function isNight(t: number): boolean {
  return wrapWorldTime(t) >= DAY_PHASE_END;
}

export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Invalid colour ${hex}`);
  const n = parseInt(match[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerpRgb = (a: Rgb, b: Rgb, f: number): Rgb => [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
/** Smooth (C1) blend factor, so the light eases in and out of every keyframe. */
const smooth = (f: number) => f * f * (3 - 2 * f);

/** Unit vector for a compass azimuth and elevation in degrees. */
export function directionFromAngles(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/** The two keyframes around phase `t` and the blend factor between them. */
export function keyframeSpan(t: number, frames = LIGHTING_KEYFRAMES): { from: Keyframe; to: Keyframe; f: number } {
  const phase = wrapWorldTime(t);
  let i = frames.length - 1;
  for (let k = 0; k < frames.length; k++) if (frames[k]!.at <= phase) i = k;
  const from = frames[i]!;
  const to = frames[(i + 1) % frames.length]!;
  const end = to.at <= from.at ? to.at + 1 : to.at;
  const start = from.at;
  const local = phase < start ? phase + 1 : phase;
  return { from, to, f: end === start ? 0 : (local - start) / (end - start) };
}

/** The lighting at phase `t`. Cheap enough to call every frame. */
export function lightingAt(t: number, frames = LIGHTING_KEYFRAMES): Lighting {
  const { from, to, f: raw } = keyframeSpan(t, frames);
  const f = smooth(raw);
  const direction = directionFromAngles(lerp(from.azimuth, to.azimuth, f), lerp(from.elevation, to.elevation, f));
  return {
    keyDirection: direction,
    keyColor: lerpRgb(hexToRgb(from.keyColor), hexToRgb(to.keyColor), f),
    keyIntensity: lerp(from.keyIntensity, to.keyIntensity, f),
    skyColor: lerpRgb(hexToRgb(from.skyColor), hexToRgb(to.skyColor), f),
    groundColor: lerpRgb(hexToRgb(from.groundColor), hexToRgb(to.groundColor), f),
    fillIntensity: lerp(from.fillIntensity, to.fillIntensity, f),
    background: lerpRgb(hexToRgb(from.background), hexToRgb(to.background), f),
    nightGlow: lerp(from.nightGlow, to.nightGlow, f),
  };
}
