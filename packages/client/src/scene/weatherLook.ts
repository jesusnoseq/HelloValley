import { WEATHERS, type Weather, type WeatherWeights } from "@hellovalley/shared";
import type { Rgb } from "./dayNight";

/**
 * How each cosmetic weather looks (GDD §4.3, build plan M12). Pure numbers, no three.js: the
 * weather driver blends them by the current weather weights every frame and the lights, fog,
 * rain streaks, wind sway and river shader read the result.
 */
export interface WeatherLook {
  /** Rain streak density and opacity, 0–1. */
  rain: number;
  /** Fog amount, 0–1 (see fogRange). */
  fog: number;
  /** Multipliers on the key (sun/moon) and hemisphere fill light: clouds dim the sun. */
  keyScale: number;
  fillScale: number;
  /** How far the background and fog colour turn towards a soft grey, 0–1. */
  overcast: number;
  /** Multiplier on the base wind that sways the canopies and grass. */
  wind: number;
  /** Rain rings on the river, 0–1. */
  ripples: number;
}

export const WEATHER_LOOKS: Readonly<Record<Weather, WeatherLook>> = {
  sun: { rain: 0, fog: 0, keyScale: 1, fillScale: 1, overcast: 0, wind: 1, ripples: 0 },
  // Light rain: dim, grey-blue, windier, a thin haze.
  rain: { rain: 1, fog: 0.3, keyScale: 0.45, fillScale: 0.9, overcast: 0.55, wind: 1.8, ripples: 1 },
  // Fog: still air, soft light, the far side of the view fades out.
  fog: { rain: 0, fog: 1, keyScale: 0.6, fillScale: 1.05, overcast: 0.45, wind: 0.35, ripples: 0 },
};

/** The look for a mix of weathers (weights summing to 1). */
export function weatherLook(weights: Readonly<WeatherWeights>): WeatherLook {
  const out: WeatherLook = { rain: 0, fog: 0, keyScale: 0, fillScale: 0, overcast: 0, wind: 0, ripples: 0 };
  for (const w of WEATHERS) {
    const k = weights[w];
    const look = WEATHER_LOOKS[w];
    for (const key of Object.keys(out) as (keyof WeatherLook)[]) out[key] += look[key] * k;
  }
  return out;
}

/** Where the fog starts in front of the camera target, in metres (the near edge of the view). */
export const FOG_START_BEFORE_TARGET = 25;
/** At full fog, the fog reaches 1 this many metres past its start. */
export const FOG_FULL_SPAN = 70;
/** Fog range used when there is no fog: far behind everything. */
export const NO_FOG_FAR = 1e5;

/**
 * Linear fog distances for a fog amount. The orthographic camera sits `cameraDistance` from its
 * target, so fog is measured from there: it starts just in front of the view and thickens with
 * depth, reaching about 0.35 x `fog` at the target and 0.65 x `fog` at the far edge of the view.
 */
export function fogRange(fog: number, cameraDistance: number): { near: number; far: number } {
  const near = cameraDistance - FOG_START_BEFORE_TARGET;
  const f = Math.min(1, Math.max(0, fog));
  if (f < 1e-3) return { near: NO_FOG_FAR, far: NO_FOG_FAR + 1 };
  return { near, far: Math.min(NO_FOG_FAR, near + FOG_FULL_SPAN / f) };
}

/** Soft overcast grey a colour turns towards: its own luminance, lifted a little and cooled. */
export function overcastColor(color: Rgb, amount: number): Rgb {
  const a = Math.min(1, Math.max(0, amount));
  const lum = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  const grey: Rgb = [Math.min(1, lum * 0.97 + 0.04), Math.min(1, lum * 1.0 + 0.05), Math.min(1, lum * 1.04 + 0.07)];
  return [color[0] + (grey[0] - color[0]) * a, color[1] + (grey[1] - color[1]) * a, color[2] + (grey[2] - color[2]) * a];
}

/** Base wind: from the west-south-west, as a sway angle (radians per metre of height). */
export const BASE_WIND: readonly [number, number] = [0.032, 0.012];

/** Wind vector for the sway shader. */
export function windVector(look: Pick<WeatherLook, "wind">): [number, number] {
  return [BASE_WIND[0] * look.wind, BASE_WIND[1] * look.wind];
}
