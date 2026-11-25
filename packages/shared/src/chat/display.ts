// Type-only imports: this module stays free of zod so the client's entry chunk can use it.
import type { PlayerProfile } from "../firestore/schemas";

/**
 * The display rule for player-to-player chat (GDD §6.6, build plan M18). Every reader sees a
 * message in **their own target language** (practice!), and hovering it shows the original as
 * written plus a translation into the reader's native language. A message the sender wrote in
 * the reader's target language is shown as written, with no translation at all.
 *
 * The rule is pure: it only says which translations a reader needs. The client runs them through
 * the hybrid AI module (`packages/client/src/ai/translate.ts`) and caches them per message id.
 */

/** The two languages that decide how one reader sees chat. */
export interface ChatReader {
  /** The language the reader is learning (the one they play in). */
  targetLang: string;
  /** The language glosses and translations are shown in. */
  nativeLang: string;
}

export interface ChatDisplayPlan {
  /** The language the line is shown in: always the reader's target language. */
  shownLang: string;
  /**
   * Translate the original into this language for the main text, or null to show the original
   * as written (the sender wrote in the reader's target language).
   */
  translateTo: string | null;
  /**
   * What hovering the line shows, or null for nothing extra (the line already is the original).
   * The original as written is always part of it; `translateTo` adds a translation into the
   * reader's native language, or is null when the original already is in that language.
   */
  hover: { translateTo: string | null } | null;
}

/** Language codes compare case-insensitively (`zh-Hant` = `zh-hant`); regional variants differ. */
export function sameLanguage(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * How `reader` sees a message the sender wrote in `messageLang`. The same rule applies to the
 * sender's own lines: a line typed in the native language shows up in the target language.
 */
export function chatDisplayPlan(messageLang: string, reader: ChatReader): ChatDisplayPlan {
  const shownLang = reader.targetLang;
  if (sameLanguage(messageLang, reader.targetLang)) return { shownLang, translateTo: null, hover: null };
  const nativeNeeded = !sameLanguage(messageLang, reader.nativeLang) && !sameLanguage(reader.nativeLang, reader.targetLang);
  return { shownLang, translateTo: reader.targetLang, hover: { translateTo: nativeNeeded ? reader.nativeLang : null } };
}

/**
 * The target language a player is playing in: the first of their target languages.
 * TODO(M24/M37): a language switcher once a player can learn several (`POST /api/langs`).
 */
export function activeTargetLang(profile: Pick<PlayerProfile, "targetLangs">): string {
  return profile.targetLangs[0]!;
}

/** The chat reader for a profile. */
export function chatReaderOf(profile: Pick<PlayerProfile, "targetLangs" | "nativeLang">): ChatReader {
  return { targetLang: activeTargetLang(profile), nativeLang: profile.nativeLang };
}
