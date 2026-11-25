import { z } from "zod";

/** The 16 pastel clothing swatches for shirt and trousers (GDD §3.3). */
export const PALETTE = [
  { id: "cream", hex: "#f6efdc" },
  { id: "butter", hex: "#f8e3a1" },
  { id: "peach", hex: "#f7c6a3" },
  { id: "coral", hex: "#f2a08f" },
  { id: "blush", hex: "#f2b8c6" },
  { id: "lilac", hex: "#d9c2e6" },
  { id: "lavender", hex: "#bfb4e3" },
  { id: "periwinkle", hex: "#a9b8ea" },
  { id: "sky", hex: "#aed6ef" },
  { id: "mint", hex: "#b5e5cf" },
  { id: "sage", hex: "#b9cba5" },
  { id: "moss", hex: "#93a676" },
  { id: "sand", hex: "#dcc7a1" },
  { id: "terracotta", hex: "#cf8a6e" },
  { id: "charcoal", hex: "#55565c" },
  { id: "navy", hex: "#4a5878" },
] as const;

export type SwatchId = (typeof PALETTE)[number]["id"];
export const SWATCH_IDS = PALETTE.map((s) => s.id) as readonly SwatchId[];
export const SwatchIdSchema = z.enum(SWATCH_IDS as [SwatchId, ...SwatchId[]]);

export function getSwatch(id: string): (typeof PALETTE)[number] | undefined {
  return PALETTE.find((s) => s.id === id);
}

/** Hue in degrees [0, 360), saturation and lightness in [0, 1]. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/**
 * The "advanced" HSL picker is clamped to this pastel range, so custom colours stay soft.
 * The curated swatches include two darker neutrals (charcoal, navy) outside it on purpose.
 */
export const PASTEL_SATURATION = { min: 0.2, max: 0.7 } as const;
export const PASTEL_LIGHTNESS = { min: 0.6, max: 0.9 } as const;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Wraps any hue into [0, 360). Non-finite hues become 0. */
export function wrapHue(h: number): number {
  if (!Number.isFinite(h)) return 0;
  const wrapped = h % 360;
  // `+ 0` turns -0 into 0.
  return (wrapped < 0 ? wrapped + 360 : wrapped) + 0;
}

/** Clamps a picker colour into the pastel range. NaN/Infinity components fall back to safe values. */
export function clampPastel(color: Hsl): Hsl {
  const midS = (PASTEL_SATURATION.min + PASTEL_SATURATION.max) / 2;
  const midL = (PASTEL_LIGHTNESS.min + PASTEL_LIGHTNESS.max) / 2;
  return {
    h: wrapHue(color.h),
    s: clamp(color.s, PASTEL_SATURATION.min, PASTEL_SATURATION.max, midS),
    l: clamp(color.l, PASTEL_LIGHTNESS.min, PASTEL_LIGHTNESS.max, midL),
  };
}

export function isPastel(color: Hsl): boolean {
  return (
    Number.isFinite(color.h) &&
    color.s >= PASTEL_SATURATION.min &&
    color.s <= PASTEL_SATURATION.max &&
    color.l >= PASTEL_LIGHTNESS.min &&
    color.l <= PASTEL_LIGHTNESS.max
  );
}

/** `#rrggbb` (lowercase) for an HSL colour. Components outside their range are clamped first. */
export function hslToHex(color: Hsl): string {
  const h = wrapHue(color.h);
  const s = clamp(color.s, 0, 1, 0);
  const l = clamp(color.l, 0, 1, 0);
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

/** Parses `#rrggbb` into HSL, or returns undefined for anything else. */
export function hexToHsl(hex: string): Hsl | undefined {
  const match = HEX_COLOR.exec(hex);
  if (!match?.[1]) return undefined;
  const int = Number.parseInt(match[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: wrapHue(h * 60), s, l };
}

/** A clothing colour: a palette swatch, or a custom picker colour (always clamped to pastel). */
export const ClothingColorSchema = z.union([
  z.object({ swatch: SwatchIdSchema }),
  z
    .object({ h: z.number(), s: z.number(), l: z.number() })
    .transform((c) => clampPastel(c)),
]);
export type ClothingColor = z.infer<typeof ClothingColorSchema>;

/** The sRGB hex a clothing colour renders as: the swatch's hex, or the (clamped) picker colour. */
export function clothingColorHex(color: { swatch: string } | Hsl): string {
  if ("swatch" in color) return getSwatch(color.swatch)?.hex ?? PALETTE[0].hex;
  return hslToHex(clampPastel(color));
}
