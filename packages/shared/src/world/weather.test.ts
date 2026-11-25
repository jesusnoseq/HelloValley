import { describe, expect, it } from "vitest";
import { WEATHERS } from "../data/world";
import {
  easeWeatherWeights,
  pureWeather,
  WEATHER_FADE_SECONDS,
  WEATHER_SLOT_MS,
  WEATHER_WEIGHTS,
  weatherAt,
  weatherForSlot,
  weatherWeights,
} from "./weather";

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("weather schedule", () => {
  it("has weights for every weather that sum to 1", () => {
    expect(Object.keys(WEATHER_WEIGHTS).sort()).toEqual([...WEATHERS].sort());
    expect(sum(WEATHER_WEIGHTS)).toBeCloseTo(1);
  });

  it("is deterministic per slot and seed", () => {
    for (let s = 0; s < 50; s++) expect(weatherForSlot(s, 7)).toBe(weatherForSlot(s, 7));
    const a = Array.from({ length: 200 }, (_, s) => weatherForSlot(s, 1)).join();
    const b = Array.from({ length: 200 }, (_, s) => weatherForSlot(s, 2)).join();
    expect(a).not.toBe(b);
  });

  it("is mostly sunny, with every weather showing up", () => {
    const counts = { sun: 0, rain: 0, fog: 0 };
    const n = 5000;
    for (let s = 0; s < n; s++) counts[weatherForSlot(s)]++;
    expect(counts.sun / n).toBeGreaterThan(0.55);
    expect(counts.rain / n).toBeGreaterThan(0.12);
    expect(counts.fog / n).toBeGreaterThan(0.06);
  });

  it("never repeats rain or fog in consecutive slots", () => {
    for (let s = 1; s < 3000; s++) {
      const w = weatherForSlot(s);
      if (w !== "sun") expect(weatherForSlot(s - 1)).not.toBe(w);
    }
  });

  it("maps real time to slots", () => {
    const t = 1_700_000_000_000;
    const now = weatherAt(t);
    expect(now.slot).toBe(Math.floor(t / WEATHER_SLOT_MS));
    expect(now.secondsIntoSlot).toBeGreaterThanOrEqual(0);
    expect(now.secondsIntoSlot).toBeLessThan(WEATHER_SLOT_MS / 1000);
    expect(now.weather).toBe(weatherForSlot(now.slot));
    expect(now.previous).toBe(weatherForSlot(now.slot - 1));
    expect(weatherAt(now.slot * WEATHER_SLOT_MS).secondsIntoSlot).toBe(0);
  });
});

describe("weather cross-fade", () => {
  it("fades smoothly from one weather to the next", () => {
    expect(weatherWeights("sun", "rain", 0)).toEqual(pureWeather("sun"));
    expect(weatherWeights("sun", "rain", WEATHER_FADE_SECONDS)).toEqual(pureWeather("rain"));
    const mid = weatherWeights("sun", "rain", WEATHER_FADE_SECONDS / 2);
    expect(mid.rain).toBeCloseTo(0.5);
    expect(mid.fog).toBe(0);
    expect(sum(mid)).toBeCloseTo(1);
    expect(weatherWeights("fog", "fog", 0)).toEqual(pureWeather("fog"));
  });

  it("eases towards the target at any frame rate", () => {
    const run = (dt: number) => {
      let w = pureWeather("sun");
      for (let t = 0; t < WEATHER_FADE_SECONDS / 2; t += dt) w = easeWeatherWeights(w, "fog", dt);
      return w;
    };
    const fast = run(1 / 120);
    const slow = run(1 / 20);
    expect(fast.fog).toBeGreaterThan(0.8);
    expect(fast.fog).toBeLessThan(1);
    expect(Math.abs(fast.fog - slow.fog)).toBeLessThan(0.02);
    expect(sum(fast)).toBeCloseTo(1);
  });

  it("settles exactly and survives bad input", () => {
    let w = pureWeather("rain");
    for (let k = 0; k < 400; k++) w = easeWeatherWeights(w, "sun", 0.1);
    expect(w).toEqual(pureWeather("sun"));
    expect(easeWeatherWeights({ sun: Number.NaN, rain: 0, fog: 0 }, "rain", 0.1)).toEqual(pureWeather("rain"));
    expect(easeWeatherWeights(pureWeather("sun"), "rain", 0)).toEqual(pureWeather("sun"));
    // Changing the target mid-fade continues from the current look.
    const half = easeWeatherWeights(pureWeather("sun"), "rain", 3);
    const turned = easeWeatherWeights(half, "fog", 0.5);
    expect(turned.rain).toBeGreaterThan(0);
    expect(turned.rain).toBeLessThan(half.rain);
    expect(sum(turned)).toBeCloseTo(1);
  });
});
