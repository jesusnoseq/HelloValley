import { z } from "zod";

/**
 * A tokenized line (GDD §6.1, build plan M19): the target-language text split into words, each
 * with its lemma, reading, gloss in the reader's native language and part of speech, plus a full
 * translation. NPC turns carry these (docs/prompts/npc-runtime.md §NPC turn, `lines[]`), and the
 * tokenize task (§5.1) makes them for chat lines and personalised openers.
 *
 * Model output is untrusted: parse it with `TokenizedLineSchema` before rendering. Unknown parts
 * of speech are dropped rather than failing the whole line.
 */

/** Parts of speech, as in the NPC turn schema. */
export const POS_TAGS = [
  "noun",
  "verb",
  "adj",
  "adv",
  "pron",
  "prep",
  "conj",
  "particle",
  "num",
  "interj",
  "punct",
  "other",
] as const;
export type PartOfSpeech = (typeof POS_TAGS)[number];

/** Limits (my numbers): a bubble line is short, and these keep a bad model answer bounded. */
export const TOKEN_LIMITS = {
  surface: 64,
  lemma: 64,
  reading: 128,
  gloss: 120,
  tokens: 80,
  text: 600,
  translation: 1000,
} as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();

/** An empty optional field means "none": drop it after parsing. */
function dropEmpty<T extends object>(value: T, keys: readonly (keyof T)[]): T {
  const out = { ...value };
  for (const key of keys) if (out[key] === "") delete out[key];
  return out;
}

export const TokenSchema = z.object({
  /** The word as written in the line. */
  surface: z.string().min(1).max(TOKEN_LIMITS.surface),
  /** Dictionary form (食べる for 食べます, querer for quieres). */
  lemma: optionalText(TOKEN_LIMITS.lemma),
  /**
   * Reading: kana for Japanese (used for furigana), pinyin for Chinese, the language's
   * romanization for other non-Latin scripts. Absent for Latin-script languages.
   */
  reading: optionalText(TOKEN_LIMITS.reading),
  /** Romanized form when it differs from `reading` (romaji for Japanese). */
  romanized: optionalText(TOKEN_LIMITS.reading),
  /** Short meaning in the reader's native language (empty for punctuation). */
  gloss: z.string().trim().max(TOKEN_LIMITS.gloss).default(""),
  pos: z.enum(POS_TAGS).optional().catch(undefined),
}).transform((t) => dropEmpty(t, ["lemma", "reading", "romanized"]));
export type Token = z.output<typeof TokenSchema>;
export type TokenInput = z.input<typeof TokenSchema>;

export const TokenizedLineSchema = z.object({
  /** The line as written. When absent it is rebuilt from the tokens. */
  text: optionalText(TOKEN_LIMITS.text),
  /** Full romanization of the line (non-Latin scripts only). */
  reading: optionalText(TOKEN_LIMITS.translation),
  /** Natural translation into the reader's native language. */
  translation: z.string().trim().max(TOKEN_LIMITS.translation),
  tokens: z.array(TokenSchema).min(1).max(TOKEN_LIMITS.tokens),
}).transform((l) => dropEmpty(l, ["text", "reading"]));
export type TokenizedLine = z.output<typeof TokenizedLineSchema>;
export type TokenizedLineInput = z.input<typeof TokenizedLineSchema>;

/** Validates a tokenized line (model output, cache entry or fixture); null when it is invalid. */
export function parseTokenizedLine(value: unknown): TokenizedLine | null {
  const result = TokenizedLineSchema.safeParse(value);
  return result.success ? result.data : null;
}
