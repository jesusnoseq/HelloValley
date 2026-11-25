// No zod here: the client's script toggle store imports this module.
import type { Romanization } from "../data/languages";

/**
 * The 3-state script toggle (GDD §6.1, build plan M19): native script only, native with the
 * reading under each word (and furigana over kanji for Japanese), or romanized only. It exists
 * only for languages whose romanization is not null (non-Latin scripts). The choice is saved per
 * target language (`users/{uid}/langs/{lang}.settings.scriptMode`).
 */
export const SCRIPT_MODES = ["native", "both", "romanized"] as const;
export type ScriptMode = (typeof SCRIPT_MODES)[number];

/**
 * The mode a language starts in. "both" (my default): most players start at A1 and cannot read
 * the script yet, and "both" still shows it.
 */
export const DEFAULT_SCRIPT_MODE: ScriptMode = "both";

export function isScriptMode(value: unknown): value is ScriptMode {
  return typeof value === "string" && (SCRIPT_MODES as readonly string[]).includes(value);
}

/** The toggle cycles native → both → romanized → native. */
export function nextScriptMode(mode: ScriptMode): ScriptMode {
  const i = SCRIPT_MODES.indexOf(mode);
  return SCRIPT_MODES[(i + 1) % SCRIPT_MODES.length]!;
}

/** Whether a language gets the toggle: only scripts with a romanization (GDD §6.1). */
export function hasScriptToggle(romanization: Romanization): boolean {
  return romanization !== null;
}

/**
 * The mode actually used: Latin-script languages are always shown as written, whatever was
 * stored for them.
 */
export function effectiveScriptMode(romanization: Romanization, stored: ScriptMode | undefined): ScriptMode {
  if (!hasScriptToggle(romanization)) return "native";
  return stored ?? DEFAULT_SCRIPT_MODE;
}

/** The toggle's label (GDD §6.1: `あ` / `あ+a` / `a`), from a sample glyph of the script. */
export function scriptModeLabel(mode: ScriptMode, sample: string): string {
  if (mode === "native") return sample;
  if (mode === "both") return `${sample}+a`;
  return "a";
}
