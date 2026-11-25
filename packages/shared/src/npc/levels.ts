import { type Cefr, cefrOf, type Level, levelBand } from "../data/difficulty";
import type { TimeOfDay } from "../data/world";
import { MAX_HEARTS } from "../firestore/schemas";

/**
 * Level, friendship and time banding for NPC prompts and cached openers
 * (docs/prompts/npc-runtime.md §1.2, §2, §3).
 */

/** npc-runtime.md §1.2 `{{cefr_descriptor}}`. */
export const CEFR_DESCRIPTORS: Readonly<Record<Cefr, string>> = {
  A1: "Very common words only, present tense, 3–7 word sentences, concrete topics (food, numbers, greetings, here/there). Repeat key words.",
  A2: 'Everyday vocabulary, simple past and future, 5–10 words, short connected sentences with "and/but/because".',
  B1: "Natural everyday speech, common idioms explained by context, 8–14 words, opinions and simple stories.",
  B2: "Fluent natural speech, idioms, humour and some slang matching your personality, varied tenses.",
  C1: "Rich, nuanced native-like speech with wordplay, proverbs and cultural references, at your natural complexity.",
  C2: "Completely natural speech, no simplification.",
};

/** Added when the NPC's tier offset would go below A1 (GDD §6.4: the offset is absorbed). */
export const SIMPLIFIED_NOTE = " Simplify even more than usual: the shortest sentences, the most common words, and repeat them.";

/** A half step (A1+) speaks between its level and the next; the prompt names the whole level. */
export function cefrDescriptor(level: Level, simplified = false): string {
  const half = level.endsWith("+") ? " You may stretch slightly towards the next level." : "";
  return CEFR_DESCRIPTORS[cefrOf(level)] + half + (simplified ? SIMPLIFIED_NOTE : "");
}

/** npc-runtime.md §1.2 `max_words_per_line`: A1 8 · A2 12 · B1 16 · B2 22 · C1+ 30. */
export function maxWordsPerLine(level: Level): number {
  const words: Record<Cefr, number> = { A1: 8, A2: 12, B1: 16, B2: 22, C1: 30, C2: 30 };
  return words[cefrOf(level)];
}

/** npc-runtime.md §1.2 `num_suggestions`: A1–A2 3 · B1 2 · B2 1 (a starter fragment) · C1+ 0. */
export function numSuggestions(level: Level): number {
  const n: Record<Cefr, number> = { A1: 3, A2: 3, B1: 2, B2: 1, C1: 0, C2: 0 };
  return n[cefrOf(level)];
}

/**
 * Suggested replies the model is asked for: as many as are shown, and one at C1+ that the
 * conversation panel keeps behind its 💡 button (GDD §6.2: "a 💡 button reveals one on demand").
 */
export function requestedSuggestions(level: Level): number {
  return Math.max(1, numSuggestions(level));
}

/**
 * How the conversation panel offers suggested replies (GDD §6.2): A1–A2 three replies, B1 two
 * (sent as they are, each with a hover translation); B2 one starter fragment that goes into the
 * input for the player to finish; C1+ none, with a 💡 that reveals one (also into the input).
 */
export type SuggestionStyle = "replies" | "starter" | "hint";

export function suggestionStyle(level: Level): SuggestionStyle {
  const n = numSuggestions(level);
  if (n === 0) return "hint";
  return n === 1 ? "starter" : "replies";
}

/** npc-runtime.md §2 `{{friendship_band_hint}}`. */
export function friendshipBandHint(hearts: number): string {
  const h = Math.floor(Math.min(MAX_HEARTS, Math.max(0, hearts)));
  if (h <= 2) return "You are polite but reserved.";
  if (h <= 5) return "You are friendly and use their name.";
  if (h <= 8) return "You are close; share small personal things.";
  return "Best friends; tease them and share secrets.";
}

/** Cached-opener friendship bands (npc-runtime.md §3): new 0–2, friendly 3–5, close 6–10 hearts. */
export const FRIENDSHIP_BANDS = ["new", "friendly", "close"] as const;
export type FriendshipBand = (typeof FRIENDSHIP_BANDS)[number];

export function friendshipBand(hearts: number): FriendshipBand {
  const h = Math.floor(Math.max(0, hearts));
  if (h <= 2) return "new";
  if (h <= 5) return "friendly";
  return "close";
}

/** Cached-opener time bands (npc-runtime.md §3): morning, afternoon, evening. Night counts as evening. */
export const OPENER_TIME_BANDS = ["morning", "afternoon", "evening"] as const;
export type OpenerTimeBand = (typeof OPENER_TIME_BANDS)[number];

export function openerTimeBand(timeOfDay: TimeOfDay): OpenerTimeBand {
  return timeOfDay === "night" ? "evening" : timeOfDay;
}

export type LevelBand = "A" | "B" | "C";

/** Openers are written for the easiest level of their band, so every player in the band follows them. */
export const BAND_LEVEL: Readonly<Record<LevelBand, Level>> = { A: "A1", B: "B1", C: "C1" };

export const openerLevelBand = (effective: Level): LevelBand => levelBand(effective);
