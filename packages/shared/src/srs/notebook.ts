import type { NotebookEntry } from "../firestore/schemas";
import { NOTEBOOK_SURFACE_MAX_LENGTH, NOTEBOOK_TEXT_MAX_LENGTH, NotebookSourceSchema } from "../firestore/schemas";
import type { SaveWordDraft } from "../language/layout";
import type { Level } from "../data/difficulty";
import { isNpcId, type NpcId } from "../data/npcs";
import { LEARNING_WORDS_MAX } from "../npc/prompt";
import { CardState, cardRetrievability, DAY_MS, type FsrsCard, newCard } from "./fsrs";

/**
 * Notebook rules (GDD §6.3, build plan M25), pure so the client, the server and the tests agree:
 * entry ids, building an entry from a clicked word, word status (new / learning / known), the
 * daily review queue, the "learning" words passed to NPC prompts, stats and the review streak.
 */

/** A stored entry without its Firestore timestamps, plus the creation time in ms. */
export interface NotebookItem {
  id: string;
  entry: Omit<NotebookEntry, "createdAt" | "updatedAt">;
  /** Creation time (epoch ms). */
  createdMs: number;
}

/** What the client writes for a new entry (the timestamps are added as `serverTimestamp()`). */
export type NotebookEntryDraft = Omit<NotebookEntry, "createdAt" | "updatedAt">;

/** A card counts as "known" once its stability reaches this many days (Anki's "mature" cards). */
export const KNOWN_STABILITY_DAYS = 21;
/** GDD §6.3: a daily review of 5–15 cards. */
export const REVIEW_SESSION_MAX = 15;
export const REVIEW_SESSION_MIN = 5;
/** New (never reviewed) cards one session may introduce (my number). */
export const REVIEW_NEW_PER_SESSION = 10;
/** A card rated Again comes back in the same session at most this many times. */
export const REVIEW_REPEATS_MAX = 2;
/** Notebook entries the server reads to pick them (the newest ones; my number). */
export const LEARNING_WORDS_SCAN = 100;

export type WordStatus = "new" | "learning" | "known";

/** Lower-case, NFC, single spaces: the form two saves of "the same word" share. */
export function normalizeWord(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** 32-bit FNV-1a over UTF-16 code units, as 8 hex digits. */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The document id of a word: one entry per lemma (or surface) per language, so saving a word
 * twice from different places keeps one card. 18 characters, always a valid Firestore id.
 */
export function notebookEntryId(word: { lemma?: string | undefined; surface: string }): string {
  const key = normalizeWord(word.lemma?.trim() ? word.lemma : word.surface);
  return `w_${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x01000193)}`;
}

const cut = (text: string | undefined, max: number) => {
  const t = text?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

/**
 * The entry for a clicked word (bubble, chat line or world label), or null when it cannot be
 * stored (empty word, unknown source). `audioHash` is the content hash of the word's clip.
 */
export function notebookEntryFromDraft(draft: SaveWordDraft, audioHash?: string): NotebookEntryDraft | null {
  const surface = cut(draft.surface, NOTEBOOK_SURFACE_MAX_LENGTH);
  if (!surface || !NotebookSourceSchema.safeParse(draft.source).success) return null;
  const entry: NotebookEntryDraft = { surface, source: draft.source };
  const lemma = cut(draft.lemma, NOTEBOOK_TEXT_MAX_LENGTH);
  const reading = cut(draft.reading, NOTEBOOK_TEXT_MAX_LENGTH);
  const gloss = cut(draft.gloss, NOTEBOOK_TEXT_MAX_LENGTH);
  const example = cut(draft.example, NOTEBOOK_TEXT_MAX_LENGTH);
  if (lemma && lemma !== surface) entry.lemma = lemma;
  if (reading && reading !== surface) entry.reading = reading;
  if (gloss) entry.gloss = gloss;
  if (example && example !== surface) entry.example = example;
  if (audioHash && /^[0-9a-f]{64}$/.test(audioHash)) entry.audioHash = audioHash;
  return entry;
}

/** The entry's card (a new one, due at creation, when it was never reviewed). */
export function cardOf(item: Pick<NotebookItem, "entry" | "createdMs">): FsrsCard {
  return item.entry.fsrs ?? newCard(item.createdMs);
}

export function wordStatus(card: FsrsCard | undefined): WordStatus {
  if (!card || card.state === CardState.New) return "new";
  if (card.state === CardState.Review && card.stability >= KNOWN_STABILITY_DAYS) return "known";
  return "learning";
}

/** The word an NPC should reuse: the dictionary form when there is one. */
export const notebookWord = (entry: Pick<NotebookEntry, "lemma" | "surface">) => (entry.lemma?.trim() ? entry.lemma : entry.surface);

/**
 * The cards of one review session (GDD §6.3: 5–15 a day): due cards first (most overdue first),
 * then new cards, oldest saved first, up to REVIEW_NEW_PER_SESSION, at most REVIEW_SESSION_MAX in
 * all. With few due cards the new ones bring the session up to its usual size.
 */
export function buildReviewQueue<T extends Pick<NotebookItem, "entry" | "createdMs">>(items: readonly T[], nowMs: number, max = REVIEW_SESSION_MAX): T[] {
  const due = items
    .filter((i) => i.entry.fsrs && i.entry.fsrs.state !== CardState.New && i.entry.fsrs.due <= nowMs)
    .sort((a, b) => a.entry.fsrs!.due - b.entry.fsrs!.due)
    .slice(0, max);
  const fresh = items
    .filter((i) => wordStatus(i.entry.fsrs) === "new")
    .sort((a, b) => a.createdMs - b.createdMs)
    .slice(0, Math.min(REVIEW_NEW_PER_SESSION, max - due.length));
  return [...due, ...fresh];
}

/** Cards due now (reviewed before and due), and new cards waiting. */
export function dueCount(items: readonly Pick<NotebookItem, "entry" | "createdMs">[], nowMs: number): number {
  return buildReviewQueue(items, nowMs, Number.MAX_SAFE_INTEGER).length;
}

/**
 * Up to `limit` words for NPC prompts (GDD §6.3 "reuse your learning words"): cards in learning
 * (reviewed, not yet known), weakest recall first; then, while there is room, new words, newest
 * saved first. Known words are left out. Duplicates (same word) count once.
 */
export function pickLearningWords(items: readonly Pick<NotebookItem, "entry" | "createdMs">[], nowMs: number, limit = LEARNING_WORDS_MAX): string[] {
  const learning = items
    .filter((i) => wordStatus(i.entry.fsrs) === "learning")
    .map((i) => ({ i, r: cardRetrievability(i.entry.fsrs!, nowMs) }))
    .sort((a, b) => a.r - b.r || b.i.createdMs - a.i.createdMs)
    .map((x) => x.i);
  const fresh = items.filter((i) => wordStatus(i.entry.fsrs) === "new").sort((a, b) => b.createdMs - a.createdMs);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of [...learning, ...fresh]) {
    if (out.length >= limit) break;
    const word = notebookWord(i.entry).trim();
    const key = normalizeWord(word);
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

export interface NotebookStats {
  total: number;
  new: number;
  learning: number;
  known: number;
  /** Cards a review session would show now. */
  due: number;
  /** Words saved per source (`npc:baker`, `object:…`, `chat`). */
  bySource: Record<string, number>;
}

/** GDD §6.3 stats: words known, and words by source NPC (the streak comes from `langs/{lang}`). */
export function notebookStats(items: readonly Pick<NotebookItem, "entry" | "createdMs">[], nowMs: number): NotebookStats {
  const stats: NotebookStats = { total: items.length, new: 0, learning: 0, known: 0, due: dueCount(items, nowMs), bySource: {} };
  for (const i of items) {
    stats[wordStatus(i.entry.fsrs)]++;
    stats.bySource[i.entry.source] = (stats.bySource[i.entry.source] ?? 0) + 1;
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------
// Review streak (langs/{lang}.streak, server-written)

/** The player's local calendar day as a day number (days since 1970-01-01 in their time zone). */
export function localDayNumber(nowMs: number, timezoneOffsetMin: number): number {
  return Math.floor((nowMs - timezoneOffsetMin * 60_000) / DAY_MS);
}

/** The UTC day number. A player's local day is within ±1 of it (time zones span UTC−12 … UTC+14). */
export const utcDayNumber = (nowMs: number) => Math.floor(nowMs / DAY_MS);

export function isPlausibleLocalDay(day: number, nowMs: number): boolean {
  return Number.isInteger(day) && Math.abs(day - utcDayNumber(nowMs)) <= 1;
}

export interface StreakState {
  streak: number;
  /** The local day of the last counted review session, null before the first. */
  day: number | null;
}

/**
 * The streak after a review session on local day `day`: the same day changes nothing, the next day
 * adds one, a gap starts again at 1. A day before the last counted one is ignored (no rewinds).
 */
export function nextStreak(prev: StreakState, day: number): StreakState & { changed: boolean } {
  if (prev.day !== null && day <= prev.day) return { ...prev, changed: false };
  const streak = prev.day !== null && day === prev.day + 1 ? prev.streak + 1 : 1;
  return { streak, day, changed: true };
}

/** The streak as shown today: it lapses once a whole day was missed. */
export function currentStreak(state: StreakState, today: number): number {
  if (state.day === null) return 0;
  return today - state.day <= 1 ? state.streak : 0;
}

// ---------------------------------------------------------------------------------------------
// Word audio

/** Who voices words that no villager said (world labels, chat words): the Librarian, who gives homework. */
export const WORD_VOICE_NPC: NpcId = "librarian";
/** Words are voiced at A1 pace (slow and clear, ai/tts.ts). */
export const WORD_VOICE_LEVEL: Level = "A1";

/** The NPC whose voice reads a saved word: the villager it came from, else WORD_VOICE_NPC. */
export function wordVoiceNpc(source: string): NpcId {
  const id = /^npc:(.+)$/.exec(source)?.[1];
  return id && isNpcId(id) ? id : WORD_VOICE_NPC;
}

/** The TTS line for a word (its key material is also the entry's `audioHash` input). */
export function wordTtsLine(word: { surface: string; source: string }, lang: string): { npcId: NpcId; lang: string; level: Level; text: string } {
  return { npcId: wordVoiceNpc(word.source), lang, level: WORD_VOICE_LEVEL, text: word.surface };
}
