import { describe, expect, it } from "vitest";
import {
  advanceWorldTime,
  DAY_LENGTH_SECONDS,
  DAY_PHASE_END,
  directionFromAngles,
  hexToRgb,
  isNight,
  keyframeSpan,
  LIGHTING_KEYFRAMES,
  lightingAt,
  type Rgb,
  wrapWorldTime,
} from "./dayNight";

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const close = (a: Rgb, b: Rgb, digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));

describe("world time", () => {
  it("wraps into 0–1", () => {
    expect(wrapWorldTime(0)).toBe(0);
    expect(wrapWorldTime(1)).toBe(0);
    expect(wrapWorldTime(1.25)).toBeCloseTo(0.25);
    expect(wrapWorldTime(-0.25)).toBeCloseTo(0.75);
    expect(wrapWorldTime(Number.NaN)).toBe(0);
  });

  it("advances one full day in 40 real minutes", () => {
    expect(DAY_LENGTH_SECONDS).toBe(2400);
    expect(advanceWorldTime(0.5, 600)).toBeCloseTo(0.75);
    expect(advanceWorldTime(0.9, 480)).toBeCloseTo(0.1);
    expect(advanceWorldTime(0, 60, 20)).toBeCloseTo(0.5);
    expect(advanceWorldTime(0.3, 100, 0)).toBeCloseTo(0.3);
  });

  it("has a 30-minute day and a 10-minute night", () => {
    expect(DAY_PHASE_END * DAY_LENGTH_SECONDS).toBe(30 * 60);
    expect(isNight(0.1)).toBe(false);
    expect(isNight(0.74)).toBe(false);
    expect(isNight(0.76)).toBe(true);
    expect(isNight(0.99)).toBe(true);
  });
});

describe("keyframes", () => {
  it("are sorted inside 0–1 with valid colours", () => {
    for (let i = 0; i < LIGHTING_KEYFRAMES.length; i++) {
      const k = LIGHTING_KEYFRAMES[i]!;
      expect(k.at).toBeGreaterThanOrEqual(0);
      expect(k.at).toBeLessThan(1);
      if (i > 0) expect(k.at).toBeGreaterThan(LIGHTING_KEYFRAMES[i - 1]!.at);
      for (const c of [k.keyColor, k.skyColor, k.groundColor, k.background]) expect(() => hexToRgb(c)).not.toThrow();
      expect(k.elevation).toBeGreaterThanOrEqual(10);
    }
  });

  it("wraps from the last keyframe back to the first", () => {
    const last = LIGHTING_KEYFRAMES[LIGHTING_KEYFRAMES.length - 1]!;
    const span = keyframeSpan((last.at + 1) / 2);
    expect(span.from).toBe(last);
    expect(span.to).toBe(LIGHTING_KEYFRAMES[0]);
    expect(span.f).toBeCloseTo(0.5);
  });
});

describe("lightingAt", () => {
  it("hits every keyframe exactly", () => {
    for (const k of LIGHTING_KEYFRAMES) {
      const l = lightingAt(k.at);
      close(l.keyColor, hexToRgb(k.keyColor));
      close(l.background, hexToRgb(k.background));
      expect(l.keyIntensity).toBeCloseTo(k.keyIntensity);
      expect(l.nightGlow).toBeCloseTo(k.nightGlow);
      close(l.keyDirection, directionFromAngles(k.azimuth, k.elevation));
    }
  });

  it("is continuous, including across the wrap at 1 → 0", () => {
    const steps = 2000;
    let prev = lightingAt(0);
    for (let i = 1; i <= steps; i++) {
      const next = lightingAt(i / steps);
      expect(Math.abs(next.keyIntensity - prev.keyIntensity)).toBeLessThan(0.05);
      expect(Math.abs(luminance(next.background) - luminance(prev.background))).toBeLessThan(0.02);
      prev = next;
    }
    close(lightingAt(1).keyColor, lightingAt(0).keyColor);
  });

  it("is bright and warm at noon and dim, cool and glowing at night", () => {
    const noon = lightingAt(0.375);
    const night = lightingAt(0.875);
    expect(noon.keyIntensity).toBeGreaterThan(night.keyIntensity * 3);
    expect(luminance(noon.background)).toBeGreaterThan(luminance(night.background) + 0.4);
    // Warm sun: more red than blue. Cool moon: more blue than red.
    expect(noon.keyColor[0]).toBeGreaterThan(noon.keyColor[2]);
    expect(night.keyColor[2]).toBeGreaterThan(night.keyColor[0]);
    expect(noon.nightGlow).toBe(0);
    expect(night.nightGlow).toBe(1);
  });

  it("keeps the key light above the horizon and the night readable", () => {
    for (let i = 0; i < 200; i++) {
      const l = lightingAt(i / 200);
      expect(Math.hypot(...l.keyDirection)).toBeCloseTo(1);
      expect(l.keyDirection[1]).toBeGreaterThan(Math.sin((10 * Math.PI) / 180) - 1e-9);
      expect(luminance(l.background)).toBeGreaterThan(0.1);
      expect(l.fillIntensity).toBeGreaterThan(0.3);
    }
  });
});

describe("helpers", () => {
  it("parses hex colours and rejects bad input", () => {
    close(hexToRgb("#ff8000"), [1, 128 / 255, 0]);
    expect(() => hexToRgb("red")).toThrow();
  });

  it("maps azimuth 0 to +Z and 90 to +X", () => {
    close(directionFromAngles(0, 0), [0, 0, 1]);
    close(directionFromAngles(90, 0), [1, 0, 0]);
    close(directionFromAngles(0, 90), [0, 1, 0]);
  });
});
