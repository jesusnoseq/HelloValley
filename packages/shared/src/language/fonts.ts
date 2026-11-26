import type { ScriptCode } from "../data/languages";

/**
 * Noto fonts per script (GDD §8 UI: Noto Sans with per-script variants, loaded on demand; build
 * plan M19). The client loads a script's family from Google Fonts the first time a line in that
 * script is shown (packages/client/src/ui/speech/fontLoader.ts). Google Fonts serves CJK fonts
 * in unicode-range slices, so a bubble only downloads the glyphs it uses; self-hosting the full
 * CJK families would mean several MB per script. The stacks fall back to system fonts, so text
 * still renders when the stylesheet is blocked or offline.
 *
 * CSP: the Hosting headers (TODO(M38), firebase.json) must allow `style-src https://fonts.googleapis.com`
 * and `font-src https://fonts.gstatic.com`, plus reCAPTCHA Enterprise for App Check (build plan M36:
 * `script-src`/`frame-src https://www.google.com https://www.gstatic.com`).
 */

export const FONT_CSS_ORIGIN = "https://fonts.googleapis.com";
export const FONT_FILE_ORIGIN = "https://fonts.gstatic.com";

export interface ScriptFont {
  /** Google Fonts family name. */
  family: string;
  /** A glyph of the script: the script toggle's label (`あ` / `あ+a` / `a`) and a font-load probe. */
  sample: string;
}

export const LATIN_FONT_FAMILY = "Noto Sans";

export const SCRIPT_FONTS: Readonly<Record<ScriptCode, ScriptFont>> = {
  Latn: { family: LATIN_FONT_FAMILY, sample: "a" },
  // Noto Sans covers Latin, Cyrillic and Greek.
  Cyrl: { family: LATIN_FONT_FAMILY, sample: "я" },
  Grek: { family: LATIN_FONT_FAMILY, sample: "α" },
  Armn: { family: "Noto Sans Armenian", sample: "ա" },
  Geor: { family: "Noto Sans Georgian", sample: "ა" },
  Arab: { family: "Noto Sans Arabic", sample: "ع" },
  Hebr: { family: "Noto Sans Hebrew", sample: "א" },
  Ethi: { family: "Noto Sans Ethiopic", sample: "አ" },
  Deva: { family: "Noto Sans Devanagari", sample: "अ" },
  Beng: { family: "Noto Sans Bengali", sample: "অ" },
  Gujr: { family: "Noto Sans Gujarati", sample: "અ" },
  Guru: { family: "Noto Sans Gurmukhi", sample: "ਅ" },
  Orya: { family: "Noto Sans Oriya", sample: "ଅ" },
  Knda: { family: "Noto Sans Kannada", sample: "ಅ" },
  Mlym: { family: "Noto Sans Malayalam", sample: "അ" },
  Taml: { family: "Noto Sans Tamil", sample: "அ" },
  Telu: { family: "Noto Sans Telugu", sample: "అ" },
  Sinh: { family: "Noto Sans Sinhala", sample: "අ" },
  Olck: { family: "Noto Sans Ol Chiki", sample: "ᱚ" },
  Khmr: { family: "Noto Sans Khmer", sample: "ក" },
  Laoo: { family: "Noto Sans Lao", sample: "ກ" },
  Jpan: { family: "Noto Sans JP", sample: "あ" },
  Hans: { family: "Noto Sans SC", sample: "汉" },
  Hant: { family: "Noto Sans TC", sample: "漢" },
  Kore: { family: "Noto Sans KR", sample: "한" },
};

const SYSTEM_FALLBACK = "system-ui, sans-serif";

/** CSS font-family for text in a script: its Noto family, then Noto Sans, then system fonts. */
export function fontStack(script: ScriptCode): string {
  const family = SCRIPT_FONTS[script].family;
  const families = family === LATIN_FONT_FAMILY ? [family] : [family, LATIN_FONT_FAMILY];
  return `${families.map((f) => `"${f}"`).join(", ")}, ${SYSTEM_FALLBACK}`;
}

/** The Google Fonts CSS2 stylesheet for a family (regular and bold, `display=swap`). */
export function googleFontsCssUrl(family: string): string {
  return `${FONT_CSS_ORIGIN}/css2?family=${family.trim().replace(/\s+/g, "+")}:wght@400;700&display=swap`;
}
