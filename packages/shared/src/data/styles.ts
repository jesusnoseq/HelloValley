import { z } from "zod";
import { getLanguage } from "./languages";

/** The four town styles (GDD §7.3). The layout is shared; the style is a per-player rendering choice. */
export const STYLE_IDS = ["european", "mediterranean", "arabic", "japanese"] as const;
export type StyleId = (typeof STYLE_IDS)[number];
export const StyleIdSchema = z.enum(STYLE_IDS);

export interface StyleDef {
  id: StyleId;
  englishName: string;
}

export const STYLES: Record<StyleId, StyleDef> = {
  european: { id: "european", englishName: "Central & Northern European" },
  mediterranean: { id: "mediterranean", englishName: "Mediterranean" },
  arabic: { id: "arabic", englishName: "Arabic" },
  japanese: { id: "japanese", englishName: "Japanese" },
};

/** Languages without an obvious match use this style until a dedicated one exists (GDD §7.3). */
export const FALLBACK_STYLE: StyleId = "mediterranean";

export function isStyleId(value: unknown): value is StyleId {
  return typeof value === "string" && (STYLE_IDS as readonly string[]).includes(value);
}

/**
 * The style pre-selected for a target language. The mapping lives in the language registry
 * (`defaultStyle`). Codes with extra subtags fall back to shorter prefixes (`pt-BR` → `pt`,
 * `zh-Hant-TW` → `zh-Hant`); unknown languages get the Mediterranean fallback.
 */
export function defaultStyleFor(lang: string): StyleId {
  const parts = lang.trim().split(/[-_]/);
  for (let n = parts.length; n > 0; n--) {
    const language = getLanguage(parts.slice(0, n).join("-"));
    if (language) return language.defaultStyle;
  }
  return FALLBACK_STYLE;
}
