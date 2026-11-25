import { describe, expect, it } from "vitest";
import { pureWeather, weatherWeights } from "@hellovalley/shared";
import { createDioramaStore } from "../state/dioramaStore";
import { CAMERA_DISTANCE } from "./cameraMath";
import { estimateDrawCalls, POST_PROCESSING_DRAWS } from "./drawCalls";
import { rainSeeds, RAIN_STREAKS } from "./Weather";
import { BASE_WIND, FOG_FULL_SPAN, fogRange, NO_FOG_FAR, overcastColor, WEATHER_LOOKS, weatherLook, windVector } from "./weatherLook";

describe("weather look", () => {
  it("is the pure look for a single weather", () => {
    expect(weatherLook(pureWeather("sun"))).toEqual(WEATHER_LOOKS.sun);
    expect(weatherLook(pureWeather("rain")).rain).toBe(1);
    expect(weatherLook(pureWeather("fog")).fog).toBe(1);
  });

  it("blends looks by the weather weights", () => {
    const mid = weatherLook(weatherWeights("sun", "rain", 10, 20));
    expect(mid.rain).toBeCloseTo(0.5);
    expect(mid.keyScale).toBeCloseTo((WEATHER_LOOKS.sun.keyScale + WEATHER_LOOKS.rain.keyScale) / 2);
    // Bad weather dims the sun but never blacks it out.
    for (const look of Object.values(WEATHER_LOOKS)) {
      expect(look.keyScale).toBeGreaterThan(0.3);
      expect(look.keyScale).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the view clear without fog and thickens it with depth", () => {
    expect(fogRange(0, CAMERA_DISTANCE).near).toBe(NO_FOG_FAR);
    const full = fogRange(1, CAMERA_DISTANCE);
    expect(full.near).toBeLessThan(CAMERA_DISTANCE);
    expect(full.far - full.near).toBeCloseTo(FOG_FULL_SPAN);
    const factor = (r: { near: number; far: number }, d: number) => Math.min(1, Math.max(0, (d - r.near) / (r.far - r.near)));
    // At the camera target the town stays readable even in thick fog; the far edge fades more.
    expect(factor(full, CAMERA_DISTANCE)).toBeGreaterThan(0.25);
    expect(factor(full, CAMERA_DISTANCE)).toBeLessThan(0.55);
    expect(factor(full, CAMERA_DISTANCE + 20)).toBeGreaterThan(factor(full, CAMERA_DISTANCE));
    // Rain's light haze is much thinner.
    const haze = fogRange(WEATHER_LOOKS.rain.fog, CAMERA_DISTANCE);
    expect(factor(haze, CAMERA_DISTANCE)).toBeLessThan(0.2);
  });

  it("greys colours for overcast skies", () => {
    expect(overcastColor([0.8, 0.6, 0.4], 0)).toEqual([0.8, 0.6, 0.4]);
    const grey = overcastColor([0.9, 0.3, 0.2], 1);
    // A soft, slightly cool grey.
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(0.08);
    expect(grey[2]).toBeGreaterThan(grey[0]);
    for (const c of overcastColor([1, 1, 1], 1)) expect(c).toBeLessThanOrEqual(1);
  });

  it("scales the wind with the weather", () => {
    expect(windVector(WEATHER_LOOKS.sun)).toEqual([...BASE_WIND]);
    expect(Math.hypot(...windVector(WEATHER_LOOKS.rain))).toBeGreaterThan(Math.hypot(...windVector(WEATHER_LOOKS.fog)));
  });
});

describe("rain streaks", () => {
  it("seeds two vertices per streak inside the unit cube", () => {
    const seeds = rainSeeds(100, 3);
    expect(seeds.length).toBe(800);
    for (let k = 0; k < 100; k++) {
      const o = k * 8;
      expect(seeds[o + 3]).toBe(0);
      expect(seeds[o + 7]).toBe(1);
      for (let c = 0; c < 3; c++) {
        expect(seeds[o + c]).toBe(seeds[o + 4 + c]);
        expect(seeds[o + c]).toBeGreaterThanOrEqual(0);
        expect(seeds[o + c]).toBeLessThan(1);
      }
    }
    expect(rainSeeds(100, 3)).toEqual(seeds);
    expect(rainSeeds().length).toBe(RAIN_STREAKS * 8);
  });
});

describe("weather in the store", () => {
  it("follows the schedule until a weather is pinned", () => {
    const store = createDioramaStore();
    expect(store.getState().weatherAuto).toBe(true);
    store.getState().setWeather("fog");
    expect(store.getState()).toMatchObject({ weather: "fog", weatherAuto: false });
    store.getState().setWeather(null);
    expect(store.getState().weatherAuto).toBe(true);
  });
});

describe("draw-call estimate", () => {
  it("counts the main pass, shadow casters and post-processing", () => {
    const items = [
      { label: "a", castShadow: true },
      { label: "b", castShadow: false },
      { label: "c", castShadow: true },
    ];
    expect(estimateDrawCalls(items)).toEqual({ main: 3, shadow: 2, post: POST_PROCESSING_DRAWS, total: 5 + POST_PROCESSING_DRAWS });
    expect(estimateDrawCalls(items, { shadows: false, post: false }).total).toBe(3);
  });
});
