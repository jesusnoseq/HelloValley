import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../data/languages";
import { LangSettingsSchema } from "../firestore/schemas";
import {
  DEFAULT_SCRIPT_MODE,
  effectiveScriptMode,
  fontStack,
  furiganaSegments,
  googleFontsCssUrl,
  hasKanji,
  isKana,
  isScriptMode,
  kanaToRomaji,
  lineText,
  linePieces,
  nextScriptMode,
  parseTokenizedLine,
  romanizedPieces,
  saveWordDraft,
  SCRIPT_FONTS,
  SCRIPT_MODES,
  scriptModeLabel,
  toHiragana,
  tokenRomanized,
  TOKEN_LIMITS,
  TokenizedLineSchema,
  type LinePiece,
  type TokenizedLine,
  type TokenizedLineInput,
} from "./index";

function line(input: TokenizedLineInput): TokenizedLine {
  return TokenizedLineSchema.parse(input);
}

const render = (pieces: LinePiece[], word: (p: Extract<LinePiece, { kind: "word" }>) => string = (p) => p.token.surface) =>
  pieces.map((p) => (p.kind === "gap" ? p.text : word(p))).join("");

const spanish = line({
  text: "¿Quieres un café?",
  translation: "Do you want a coffee?",
  tokens: [
    { surface: "¿", gloss: "", pos: "punct" },
    { surface: "Quieres", lemma: "querer", gloss: "you want", pos: "verb" },
    { surface: "un", gloss: "a", pos: "other" },
    { surface: "café", gloss: "coffee", pos: "noun" },
    { surface: "?", gloss: "", pos: "punct" },
  ],
});

const japanese = line({
  text: "パンを食べますか？",
  translation: "Will you eat bread?",
  tokens: [
    { surface: "パン", reading: "パン", romanized: "pan", gloss: "bread", pos: "noun" },
    { surface: "を", reading: "を", gloss: "object marker", pos: "particle" },
    { surface: "食べます", lemma: "食べる", reading: "たべます", gloss: "eat", pos: "verb" },
    { surface: "か", gloss: "question marker", pos: "particle" },
    { surface: "？", gloss: "", pos: "punct" },
  ],
});

describe("tokenized line schema", () => {
  it("parses a valid line and defaults gloss", () => {
    const parsed = parseTokenizedLine({ translation: "Hi", tokens: [{ surface: "Hola" }] });
    expect(parsed).toEqual({ translation: "Hi", tokens: [{ surface: "Hola", gloss: "" }] });
  });

  it("treats empty optional fields as absent and trims", () => {
    const parsed = parseTokenizedLine({ text: " ", translation: " Hi ", tokens: [{ surface: "Hola", lemma: "", reading: " ", gloss: " hi " }] });
    expect(parsed?.text).toBeUndefined();
    expect(parsed?.translation).toBe("Hi");
    expect(parsed?.tokens[0]).toEqual({ surface: "Hola", gloss: "hi" });
  });

  it("drops an unknown part of speech instead of failing the line", () => {
    const parsed = parseTokenizedLine({ translation: "x", tokens: [{ surface: "a", gloss: "", pos: "adjective" }] });
    expect(parsed?.tokens[0]?.pos).toBeUndefined();
  });

  it("rejects missing or empty tokens, empty surfaces and oversize fields", () => {
    expect(parseTokenizedLine({ translation: "x" })).toBeNull();
    expect(parseTokenizedLine({ translation: "x", tokens: [] })).toBeNull();
    expect(parseTokenizedLine({ translation: "x", tokens: [{ surface: "" }] })).toBeNull();
    expect(parseTokenizedLine({ tokens: [{ surface: "a" }] })).toBeNull();
    expect(parseTokenizedLine({ translation: "x", tokens: [{ surface: "a".repeat(TOKEN_LIMITS.surface + 1) }] })).toBeNull();
    const many = Array.from({ length: TOKEN_LIMITS.tokens + 1 }, () => ({ surface: "a" }));
    expect(parseTokenizedLine({ translation: "x", tokens: many })).toBeNull();
    expect(parseTokenizedLine("not a line")).toBeNull();
  });
});

describe("script modes", () => {
  it("cycles native → both → romanized → native", () => {
    expect(nextScriptMode("native")).toBe("both");
    expect(nextScriptMode("both")).toBe("romanized");
    expect(nextScriptMode("romanized")).toBe("native");
  });

  it("only non-Latin scripts get the toggle", () => {
    expect(effectiveScriptMode(null, "romanized")).toBe("native");
    expect(effectiveScriptMode("romaji", undefined)).toBe(DEFAULT_SCRIPT_MODE);
    expect(effectiveScriptMode("pinyin", "romanized")).toBe("romanized");
  });

  it("labels the states like the GDD (あ / あ+a / a)", () => {
    expect(SCRIPT_MODES.map((m) => scriptModeLabel(m, "あ"))).toEqual(["あ", "あ+a", "a"]);
  });

  it("matches the Firestore settings schema", () => {
    for (const mode of SCRIPT_MODES) expect(LangSettingsSchema.safeParse({ scriptMode: mode }).success).toBe(true);
    expect(isScriptMode("both")).toBe(true);
    expect(isScriptMode("kana")).toBe(false);
  });
});

describe("japanese", () => {
  it("detects kana and kanji", () => {
    expect(isKana("たべます")).toBe(true);
    expect(isKana("ラーメン")).toBe(true);
    expect(isKana("食べます")).toBe(false);
    expect(hasKanji("食べます")).toBe(true);
    expect(hasKanji("パン")).toBe(false);
    expect(toHiragana("パン")).toBe("ぱん");
  });

  it("puts furigana only over the kanji", () => {
    expect(furiganaSegments("食べます", "たべます")).toEqual([{ text: "食", ruby: "た" }, { text: "べます" }]);
    expect(furiganaSegments("お茶", "おちゃ")).toEqual([{ text: "お" }, { text: "茶", ruby: "ちゃ" }]);
    expect(furiganaSegments("今日", "きょう")).toEqual([{ text: "今日", ruby: "きょう" }]);
    expect(furiganaSegments("来ました", "きました")).toEqual([{ text: "来", ruby: "き" }, { text: "ました" }]);
    expect(furiganaSegments("食べ物", "たべもの")).toEqual([
      { text: "食", ruby: "た" },
      { text: "べ" },
      { text: "物", ruby: "もの" },
    ]);
  });

  it("gives the whole word the reading when it cannot be aligned, and no ruby without kanji or kana", () => {
    expect(furiganaSegments("食べます", "のみます")).toEqual([{ text: "食べます", ruby: "のみます" }]);
    expect(furiganaSegments("パン", "パン")).toEqual([{ text: "パン" }]);
    expect(furiganaSegments("食べます", "tabemasu")).toEqual([{ text: "食べます" }]);
    expect(furiganaSegments("食べます", undefined)).toEqual([{ text: "食べます" }]);
  });

  it("converts kana to Hepburn romaji", () => {
    expect(kanaToRomaji("こんにちは")).toBe("konnichiha");
    expect(kanaToRomaji("きょう")).toBe("kyou");
    expect(kanaToRomaji("しゃしん")).toBe("shashin");
    expect(kanaToRomaji("ちゃ")).toBe("cha");
    expect(kanaToRomaji("じゃあ")).toBe("jaa");
    expect(kanaToRomaji("がっこう")).toBe("gakkou");
    expect(kanaToRomaji("まっちゃ")).toBe("matcha");
    expect(kanaToRomaji("ラーメン")).toBe("raamen");
    expect(kanaToRomaji("きんえん")).toBe("kin'en");
    expect(kanaToRomaji("ファン")).toBe("fan");
  });
});

describe("line layout", () => {
  it("keeps the spacing of the text", () => {
    const pieces = linePieces(spanish, "Latn");
    expect(render(pieces)).toBe("¿Quieres un café?");
    expect(pieces.filter((p) => p.kind === "word").map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("joins words by script when there is no text or the tokens do not match it", () => {
    const { text: _text, ...noText } = spanish;
    expect(render(linePieces(noText, "Latn"))).toBe("¿Quieres un café?");
    expect(render(linePieces({ ...spanish, text: "something else" }, "Latn"))).toBe("¿Quieres un café?");
    const { text: _ja, ...jaNoText } = japanese;
    expect(render(linePieces(jaNoText, "Jpan"))).toBe("パンを食べますか？");
  });

  it("keeps untokenized text between words as gaps", () => {
    const l = line({ text: "Hola, amigo", translation: "Hi, friend", tokens: [{ surface: "Hola" }, { surface: "amigo" }] });
    expect(linePieces(l, "Latn")).toEqual([
      { kind: "word", index: 0, token: l.tokens[0] },
      { kind: "gap", text: ", " },
      { kind: "word", index: 1, token: l.tokens[1] },
    ]);
  });

  it("romanizes Japanese with particles, kana fallback and Latin punctuation", () => {
    expect(render(romanizedPieces(japanese, "Jpan"), (p) => tokenRomanized(p.token, "Jpan"))).toBe("pan o tabemasu ka?");
  });

  it("romanizes other scripts from the token reading", () => {
    const ru = line({ text: "Привет!", translation: "Hi!", tokens: [{ surface: "Привет", reading: "privet" }, { surface: "!", pos: "punct" }] });
    expect(render(romanizedPieces(ru, "Cyrl"), (p) => tokenRomanized(p.token, "Cyrl"))).toBe("privet!");
    const ar = line({ translation: "Coffee?", tokens: [{ surface: "قهوة", reading: "qahwa" }, { surface: "؟", pos: "punct" }] });
    expect(render(romanizedPieces(ar, "Arab"), (p) => tokenRomanized(p.token, "Arab"))).toBe("qahwa?");
  });

  it("rebuilds the text when it is absent", () => {
    const { text: _text, ...noText } = japanese;
    expect(lineText(noText, "Jpan")).toBe("パンを食べますか？");
    expect(lineText(spanish, "Latn")).toBe("¿Quieres un café?");
  });
});

describe("save word draft", () => {
  it("uses the line as the example and the kana as the Japanese reading", () => {
    expect(saveWordDraft(japanese, 2, "ja", "Jpan", "npc:baker")).toEqual({
      lang: "ja",
      surface: "食べます",
      lemma: "食べる",
      reading: "たべます",
      gloss: "eat",
      pos: "verb",
      example: "パンを食べますか？",
      source: "npc:baker",
    });
  });

  it("skips punctuation and unknown indexes", () => {
    expect(saveWordDraft(spanish, 0, "es", "Latn", "chat")).toBeNull();
    expect(saveWordDraft(spanish, 99, "es", "Latn", "chat")).toBeNull();
    expect(saveWordDraft(spanish, 1, "es", "Latn", "chat")).toMatchObject({ surface: "Quieres", lemma: "querer", example: "¿Quieres un café?" });
  });
});

describe("fonts", () => {
  it("has a Noto family for every script a language uses", () => {
    for (const l of LANGUAGES) {
      const font = SCRIPT_FONTS[l.script];
      expect(font.family, l.code).toMatch(/^Noto Sans/);
      expect([...font.sample]).toHaveLength(1);
    }
  });

  it("builds a stack with system fallbacks and a Google Fonts URL", () => {
    expect(fontStack("Jpan")).toBe('"Noto Sans JP", "Noto Sans", system-ui, sans-serif');
    expect(fontStack("Latn")).toBe('"Noto Sans", system-ui, sans-serif');
    expect(googleFontsCssUrl("Noto Sans JP")).toBe("https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap");
  });
});
