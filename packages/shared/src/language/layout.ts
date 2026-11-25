import type { ScriptCode } from "../data/languages";
import { isKana, kanaToRomaji } from "./japanese";
import type { PartOfSpeech, Token, TokenizedLine } from "./tokens";

/**
 * How a tokenized line is laid out in a speech bubble (build plan M19). Pure, so the client
 * component only maps pieces to elements.
 */

/** A word (hoverable, clickable) or the text between words (spaces, untokenized punctuation). */
export type LinePiece = { kind: "word"; index: number; token: Token } | { kind: "gap"; text: string };

/** Scripts written without spaces between words. */
const NO_SPACE_SCRIPTS: ReadonlySet<ScriptCode> = new Set(["Jpan", "Hans", "Hant", "Khmr", "Laoo"]);

const NO_SPACE_BEFORE = /^[.,!?;:…%)\]}»”’、。！？，．：；）」』】〉》؟،؛]+$/u;
const NO_SPACE_AFTER = /^[¿¡([{«“‘（「『【〈《]+$/u;

export function isPunctuation(token: Pick<Token, "surface" | "pos">): boolean {
  return token.pos === "punct" || /^[\p{P}\p{S}]+$/u.test(token.surface);
}

/** Joins words the way the script does: CJK without spaces, others with spaces around punctuation rules. */
function joinTokens<T>(items: readonly T[], surface: (item: T) => string, spaced: boolean): Array<{ item: T } | { gap: string }> {
  const out: Array<{ item: T } | { gap: string }> = [];
  items.forEach((item, i) => {
    if (i > 0 && spaced) {
      const prev = surface(items[i - 1]!);
      if (!NO_SPACE_BEFORE.test(surface(item)) && !NO_SPACE_AFTER.test(prev)) out.push({ gap: " " });
    }
    out.push({ item });
  });
  return out;
}

/** Finds each token in the text in order; null when one is missing (the tokens do not match it). */
function align(text: string, tokens: readonly Token[]): LinePiece[] | null {
  const pieces: LinePiece[] = [];
  let cursor = 0;
  for (const [index, token] of tokens.entries()) {
    const surface = token.surface.normalize("NFC");
    const at = text.indexOf(surface, cursor);
    if (at < 0) return null;
    if (at > cursor) pieces.push({ kind: "gap", text: text.slice(cursor, at) });
    pieces.push({ kind: "word", index, token });
    cursor = at + surface.length;
  }
  if (cursor < text.length) pieces.push({ kind: "gap", text: text.slice(cursor) });
  return pieces;
}

/**
 * The line in its own script as words and gaps. The line's `text` is the source of truth for the
 * spacing between words; without it (or when the tokens do not match it) the words are joined
 * the way the script is written.
 */
export function linePieces(line: TokenizedLine, script: ScriptCode): LinePiece[] {
  if (line.text) {
    const aligned = align(line.text.normalize("NFC"), line.tokens);
    if (aligned) return aligned;
  }
  return toPieces(line.tokens, (t) => t.surface, !NO_SPACE_SCRIPTS.has(script));
}

function toPieces(tokens: readonly Token[], surface: (token: Token) => string, spaced: boolean): LinePiece[] {
  const words = tokens.map((token, index) => ({ token, index }));
  return joinTokens(words, (w) => surface(w.token), spaced).map(
    (p): LinePiece => ("gap" in p ? { kind: "gap", text: p.gap } : { kind: "word", index: p.item.index, token: p.item.token }),
  );
}

/** The line as written (its `text`, or the words joined). */
export function lineText(line: TokenizedLine, script: ScriptCode): string {
  return line.text ?? linePieces(line, script).map((p) => (p.kind === "gap" ? p.text : p.token.surface)).join("");
}

/** CJK and Arabic punctuation in a romanized line. */
const LATIN_PUNCT: Readonly<Record<string, string>> = {
  "。": ".", "、": ",", "！": "!", "？": "?", "，": ",", "．": ".", "：": ":", "；": ";",
  "「": "“", "」": "”", "『": "“", "』": "”", "（": "(", "）": ")", "・": " ",
  "؟": "?", "،": ",", "؛": ";",
};

function latinPunctuation(text: string): string {
  return [...text].map((c) => LATIN_PUNCT[c] ?? c).join("");
}

/** Japanese particles that are read differently from their kana. */
const JA_PARTICLES: Readonly<Record<string, string>> = { は: "wa", へ: "e", を: "o" };

/** The kana reading of a Japanese word (for furigana and romaji), if it has one. */
export function japaneseKana(token: Token): string | undefined {
  if (token.reading && isKana(token.reading)) return token.reading;
  if (isKana(token.surface)) return token.surface;
  return undefined;
}

/**
 * A word's romanized form: the token's `romanized`, else its reading (kana → romaji for
 * Japanese), else the surface. Punctuation is mapped to Latin punctuation.
 */
export function tokenRomanized(token: Token, script: ScriptCode): string {
  if (isPunctuation(token)) return latinPunctuation(token.surface);
  if (token.romanized) return token.romanized;
  if (script === "Jpan") {
    const particle = token.pos === "particle" ? JA_PARTICLES[token.surface] : undefined;
    if (particle) return particle;
    const kana = japaneseKana(token);
    if (kana) return kanaToRomaji(kana);
  }
  return token.reading ?? token.surface;
}

/** The reading shown under a word in "both" mode (nothing for punctuation). */
export function tokenReadingLine(token: Token, script: ScriptCode): string {
  return isPunctuation(token) ? "" : tokenRomanized(token, script);
}

/** The romanized line as words and gaps (always spaced, Latin punctuation). */
export function romanizedPieces(line: TokenizedLine, script: ScriptCode): LinePiece[] {
  return toPieces(line.tokens, (t) => tokenRomanized(t, script), true);
}

/** What clicking a word sends to the notebook (GDD §6.3: the sentence is the example). */
export interface SaveWordDraft {
  lang: string;
  surface: string;
  lemma?: string;
  reading?: string;
  gloss?: string;
  pos?: PartOfSpeech;
  /** The whole line, as written. */
  example: string;
  /** `npc:{npcId}`, `object:{labelKey}` or `chat` (firestore.rules notebook `source`). */
  source: string;
}

export function saveWordDraft(line: TokenizedLine, index: number, lang: string, script: ScriptCode, source: string): SaveWordDraft | null {
  const token = line.tokens[index];
  if (!token || isPunctuation(token)) return null;
  const reading = script === "Jpan" ? (japaneseKana(token) ?? token.romanized) : (token.reading ?? token.romanized);
  const draft: SaveWordDraft = { lang, surface: token.surface, example: lineText(line, script), source };
  if (token.lemma) draft.lemma = token.lemma;
  if (reading) draft.reading = reading;
  if (token.gloss) draft.gloss = token.gloss;
  if (token.pos) draft.pos = token.pos;
  return draft;
}
