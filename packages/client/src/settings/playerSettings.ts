import { DEFAULT_KEYMAP, type Keymap, parseKeymap } from "../input/keymap";

/**
 * Accessibility and display settings (build plan M37), saved per player on this device. Pure: no
 * DOM, no shared values (the settings store is in the entry chunk).
 */

/** UI text size, as a scale on the HUD and panels (WCAG 1.4.4 asks for up to 200 % via the browser too). */
export const TEXT_SIZES = { normal: 1, large: 1.15, larger: 1.3, largest: 1.5 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const TEXT_SIZE_IDS = Object.keys(TEXT_SIZES) as TextSize[];

/** UI accent colours: the cozy defaults, or a colour-blind-safe set (Okabe–Ito). */
export const ACCENT_PALETTES = ["cozy", "colorblind"] as const;
export type AccentPalette = (typeof ACCENT_PALETTES)[number];

/** Reduced motion: follow the system setting, or force it on or off. */
export const MOTION_PREFS = ["system", "reduce", "full"] as const;
export type MotionPref = (typeof MOTION_PREFS)[number];

/** Graphics quality: `low` turns post-processing off (the integrated-GPU fallback). */
export const QUALITY_LEVELS = ["high", "low"] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];

export interface PlayerSettings {
  textSize: TextSize;
  accents: AccentPalette;
  motion: MotionPref;
  /** Tilt-shift blur (the miniature look); always off with reduced motion. */
  tiltShift: boolean;
  quality: Quality;
  /** Show the microphone button in conversations (speech input, M22). */
  micButton: boolean;
  keymap: Keymap;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  textSize: "normal",
  accents: "cozy",
  motion: "system",
  tiltShift: true,
  quality: "high",
  micButton: true,
  keymap: DEFAULT_KEYMAP,
};

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Settings from saved data; anything missing or malformed takes its default. */
export function parsePlayerSettings(raw: unknown): PlayerSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    textSize: oneOf(TEXT_SIZE_IDS, r.textSize, DEFAULT_SETTINGS.textSize),
    accents: oneOf(ACCENT_PALETTES, r.accents, DEFAULT_SETTINGS.accents),
    motion: oneOf(MOTION_PREFS, r.motion, DEFAULT_SETTINGS.motion),
    tiltShift: typeof r.tiltShift === "boolean" ? r.tiltShift : DEFAULT_SETTINGS.tiltShift,
    quality: oneOf(QUALITY_LEVELS, r.quality, DEFAULT_SETTINGS.quality),
    micButton: typeof r.micButton === "boolean" ? r.micButton : DEFAULT_SETTINGS.micButton,
    keymap: parseKeymap(r.keymap),
  };
}

/** Whether motion is reduced, given the system's `prefers-reduced-motion`. */
export function reducesMotion(settings: Pick<PlayerSettings, "motion">, systemPrefersReduced: boolean): boolean {
  return settings.motion === "reduce" || (settings.motion === "system" && systemPrefersReduced);
}

/** What the renderer does with the settings: tilt-shift needs full motion and high quality. */
export function renderOptions(settings: PlayerSettings, systemPrefersReduced: boolean): { effects: boolean; tiltShift: boolean; cameraEasing: boolean } {
  const reduced = reducesMotion(settings, systemPrefersReduced);
  const effects = settings.quality === "high";
  return { effects, tiltShift: effects && settings.tiltShift && !reduced, cameraEasing: !reduced };
}
