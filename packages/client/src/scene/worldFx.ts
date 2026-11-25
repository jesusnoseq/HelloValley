import { Color, Vector2 } from "three";
import { pureWeather, type WeatherWeights } from "@hellovalley/shared";
import { WEATHER_LOOKS, type WeatherLook } from "./weatherLook";

/**
 * Per-frame values shared by the animated materials (river, canopy sway, rain). One uniform
 * object each, referenced by every material that uses it, so the weather driver updates them
 * with a few writes per frame and no material needs to know about the others.
 */
export const worldUniforms = {
  /** Seconds since the page loaded (wraps every hour to keep float precision). */
  uHvTime: { value: 0 },
  /** Wind as a sway angle per metre of height, x/z in the town frame. */
  uHvWind: { value: new Vector2() },
  /** Rain amount, 0–1 (river ripples). */
  uHvRain: { value: 0 },
  /** Sky colour the river reflects (linear). */
  uHvSky: { value: new Color("#d4ebfa") },
};

export const TIME_WRAP_SECONDS = 3600;

/** The weather the scene shows right now (eased), written by WeatherDriver every frame. */
export const weatherRuntime: { weights: WeatherWeights; look: WeatherLook } = {
  weights: pureWeather("sun"),
  look: { ...WEATHER_LOOKS.sun },
};
