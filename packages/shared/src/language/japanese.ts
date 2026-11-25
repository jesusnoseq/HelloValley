/**
 * Japanese helpers for the speech bubble (GDD §6.1, build plan M19): kana detection, furigana
 * alignment (ruby only over the kanji of a word, not its okurigana) and a Hepburn kana → romaji
 * fallback for tokens that come without a romanized form.
 */

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶヵ]/u;
const KANA_ONLY = /^[ぁ-ゖゝゞァ-ヺーヽヾ]+$/u;

export function hasKanji(text: string): boolean {
  return KANJI.test(text);
}

/** Only hiragana, katakana and the long-vowel mark. */
export function isKana(text: string): boolean {
  return KANA_ONLY.test(text);
}

/** Katakana → hiragana (other characters unchanged). */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** One piece of a word: plain text, or kanji with their reading as ruby. */
export interface RubySegment {
  text: string;
  ruby?: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits a word into ruby segments: each kanji run gets its part of the reading, kana stay plain
 * (食べます + たべます → 食[た] べます). When the reading cannot be aligned, the whole word gets it.
 * Words without kanji, or without a kana reading, get no ruby.
 */
export function furiganaSegments(surface: string, reading: string | undefined): RubySegment[] {
  if (!hasKanji(surface) || !reading || !isKana(reading)) return [{ text: surface }];
  const runs: { text: string; kanji: boolean }[] = [];
  for (const char of surface) {
    const kanji = hasKanji(char);
    const last = runs.at(-1);
    if (last && last.kanji === kanji) last.text += char;
    else runs.push({ text: char, kanji });
  }
  const pattern = new RegExp(`^${runs.map((r) => (r.kanji ? "(.+?)" : escapeRegExp(toHiragana(r.text)))).join("")}$`, "u");
  const match = pattern.exec(toHiragana(reading));
  if (!match) return [{ text: surface, ruby: reading }];
  let group = 1;
  return runs.map((r) => (r.kanji ? { text: r.text, ruby: match[group++]! } : { text: r.text }));
}

const ROMAJI: Readonly<Record<string, string>> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "i", ゑ: "e", を: "o", ん: "n", ゔ: "vu",
};
const SMALL_Y: Readonly<Record<string, string>> = { ゃ: "a", ゅ: "u", ょ: "o" };
const SMALL_VOWEL: Readonly<Record<string, string>> = { ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゎ: "a" };

/**
 * Kana → Hepburn romaji (きょう → kyou, がっこう → gakkou, ラーメン → raamen). Long vowels are
 * spelled out rather than macronised. Characters that are not kana are kept as they are.
 */
export function kanaToRomaji(kana: string): string {
  let out = "";
  let double = false;
  for (const char of toHiragana(kana)) {
    if (char === "っ") {
      double = true;
      continue;
    } else if (SMALL_Y[char] !== undefined) {
      // きゃ → kya, しゃ → sha, ちゃ → cha, じゃ → ja.
      const vowel = SMALL_Y[char]!;
      if (/(sh|ch|j)i$/.test(out)) out = out.slice(0, -1) + vowel;
      else if (out.endsWith("i")) out = out.slice(0, -1) + "y" + vowel;
      else out += "y" + vowel;
      continue;
    } else if (SMALL_VOWEL[char] !== undefined) {
      // ふぁ → fa, てぃ → ti, フォ → fo.
      const vowel = SMALL_VOWEL[char]!;
      out = /[aeiou]$/.test(out) && out.length > 1 ? out.slice(0, -1) + vowel : out + vowel;
      continue;
    } else if (char === "ー") {
      out += /[aeiou]$/.test(out) ? out.at(-1)! : "";
      continue;
    }
    const piece = ROMAJI[char] ?? char;
    if (double) {
      // っち → tchi, っか → kka.
      out += piece.startsWith("ch") ? "t" : /^[a-z]/.test(piece) && !/^[aeiou]/.test(piece) ? piece[0]! : "";
      double = false;
    }
    // ん before a vowel or y is written n' (kin'en).
    // Every other kana ends in a vowel, so a trailing n is always ん.
    if (out.endsWith("n") && /^[aeiouy]/.test(piece)) out += "'";
    out += piece;
  }
  return out;
}

