import { describe, expect, it } from "vitest";
import {
  ClothingColorSchema,
  clampPastel,
  getSwatch,
  hexToHsl,
  hslToHex,
  isPastel,
  PALETTE,
  PASTEL_LIGHTNESS,
  PASTEL_SATURATION,
  SwatchIdSchema,
  wrapHue,
} from "./palette";

describe("palette", () => {
  it("has the 16 GDD §3.3 swatches with valid hex colours", () => {
    expect(PALETTE.map((s) => s.id)).toEqual([
      "cream",
      "butter",
      "peach",
      "coral",
      "blush",
      "lilac",
      "lavender",
      "periwinkle",
      "sky",
      "mint",
      "sage",
      "moss",
      "sand",
      "terracotta",
      "charcoal",
      "navy",
    ]);
    for (const swatch of PALETTE) expect(swatch.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(PALETTE.map((s) => s.hex)).size).toBe(16);
    expect(getSwatch("mint")?.hex).toBe("#b5e5cf");
    expect(getSwatch("neon")).toBeUndefined();
    expect(SwatchIdSchema.safeParse("sky").success).toBe(true);
    expect(SwatchIdSchema.safeParse("neon").success).toBe(false);
  });

  it("swatches round-trip through HSL", () => {
    for (const swatch of PALETTE) expect(hslToHex(hexToHsl(swatch.hex)!)).toBe(swatch.hex);
  });
});

describe("wrapHue", () => {
  it("wraps into [0, 360)", () => {
    expect(wrapHue(0)).toBe(0);
    expect(wrapHue(359.5)).toBe(359.5);
    expect(wrapHue(360)).toBe(0);
    expect(wrapHue(725)).toBe(5);
    expect(wrapHue(-30)).toBe(330);
    expect(wrapHue(-360)).toBe(0);
    expect(Object.is(wrapHue(-0), 0)).toBe(true);
    expect(wrapHue(Number.NaN)).toBe(0);
    expect(wrapHue(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("clampPastel", () => {
  const { min: sMin, max: sMax } = PASTEL_SATURATION;
  const { min: lMin, max: lMax } = PASTEL_LIGHTNESS;

  it("leaves colours already in the pastel range unchanged", () => {
    const inside = { h: 200, s: 0.5, l: 0.75 };
    expect(clampPastel(inside)).toEqual(inside);
    expect(clampPastel({ h: 10, s: sMin, l: lMin })).toEqual({ h: 10, s: sMin, l: lMin });
    expect(clampPastel({ h: 10, s: sMax, l: lMax })).toEqual({ h: 10, s: sMax, l: lMax });
  });

  it("clamps saturation and lightness independently", () => {
    expect(clampPastel({ h: 120, s: 1, l: 0.75 })).toEqual({ h: 120, s: sMax, l: 0.75 });
    expect(clampPastel({ h: 120, s: 0, l: 0.75 })).toEqual({ h: 120, s: sMin, l: 0.75 });
    expect(clampPastel({ h: 120, s: 0.5, l: 0.1 })).toEqual({ h: 120, s: 0.5, l: lMin });
    expect(clampPastel({ h: 120, s: 0.5, l: 1 })).toEqual({ h: 120, s: 0.5, l: lMax });
    expect(clampPastel({ h: 120, s: -5, l: 5 })).toEqual({ h: 120, s: sMin, l: lMax });
  });

  it("wraps the hue instead of clamping it", () => {
    expect(clampPastel({ h: 400, s: 0.5, l: 0.75 }).h).toBe(40);
    expect(clampPastel({ h: -90, s: 0.5, l: 0.75 }).h).toBe(270);
  });

  it("replaces non-finite components with safe values", () => {
    const fixed = clampPastel({ h: Number.NaN, s: Number.NaN, l: Number.POSITIVE_INFINITY });
    expect(fixed.h).toBe(0);
    expect(fixed.s).toBeCloseTo((sMin + sMax) / 2);
    expect(fixed.l).toBeCloseTo((lMin + lMax) / 2);
  });

  it("always returns a pastel colour and is idempotent", () => {
    const samples = [-1, 0, 0.1, 0.33, 0.5, 0.8, 1, 2];
    for (const h of [-720, -1, 0, 90, 359, 1000]) {
      for (const s of samples) {
        for (const l of samples) {
          const once = clampPastel({ h, s, l });
          expect(isPastel(once)).toBe(true);
          expect(once.h).toBeGreaterThanOrEqual(0);
          expect(once.h).toBeLessThan(360);
          expect(clampPastel(once)).toEqual(once);
        }
      }
    }
  });

  it("isPastel rejects colours outside the range", () => {
    expect(isPastel({ h: 0, s: 0.9, l: 0.75 })).toBe(false);
    expect(isPastel({ h: 0, s: 0.5, l: 0.3 })).toBe(false);
    expect(isPastel({ h: Number.NaN, s: 0.5, l: 0.75 })).toBe(false);
  });
});

describe("hex conversion", () => {
  it("converts known colours", () => {
    expect(hslToHex({ h: 0, s: 1, l: 0.5 })).toBe("#ff0000");
    expect(hslToHex({ h: 120, s: 1, l: 0.5 })).toBe("#00ff00");
    expect(hslToHex({ h: 240, s: 1, l: 0.5 })).toBe("#0000ff");
    expect(hslToHex({ h: 0, s: 0, l: 1 })).toBe("#ffffff");
    expect(hslToHex({ h: 0, s: 2, l: -1 })).toBe("#000000");
    expect(hexToHsl("#ffffff")).toEqual({ h: 0, s: 0, l: 1 });
    expect(hexToHsl("#00FF00")).toEqual({ h: 120, s: 1, l: 0.5 });
    expect(hexToHsl("#0000ff")).toEqual({ h: 240, s: 1, l: 0.5 });
    expect(hexToHsl("red")).toBeUndefined();
    expect(hexToHsl("#fff")).toBeUndefined();
  });
});

describe("ClothingColorSchema", () => {
  it("accepts a swatch or a custom colour, clamping the custom one", () => {
    expect(ClothingColorSchema.parse({ swatch: "coral" })).toEqual({ swatch: "coral" });
    expect(ClothingColorSchema.parse({ h: 370, s: 1, l: 0.2 })).toEqual({ h: 10, s: PASTEL_SATURATION.max, l: PASTEL_LIGHTNESS.min });
    expect(ClothingColorSchema.safeParse({ swatch: "neon" }).success).toBe(false);
    expect(ClothingColorSchema.safeParse({ h: "red" }).success).toBe(false);
  });
});
