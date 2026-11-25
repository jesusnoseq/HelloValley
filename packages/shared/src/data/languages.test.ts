import { describe, expect, it } from "vitest";
import {
  FEATURED_LANGUAGE_CODES,
  getLanguage,
  isLanguageCode,
  LANGUAGE_CODES,
  LanguageCodeSchema,
  LANGUAGES,
  languagesForPicker,
} from "./languages";

describe("languages", () => {
  it("lists every Flash-Lite TTS language once", () => {
    // docs/hellovalley-village-npcs.md "Full list" has 103 entries.
    expect(LANGUAGES).toHaveLength(103);
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGES.length);
    expect(new Set(LANGUAGE_CODES.map((c) => c.toLowerCase())).size).toBe(LANGUAGES.length);
    expect(new Set(LANGUAGES.map((l) => l.englishName)).size).toBe(LANGUAGES.length);
    for (const l of LANGUAGES) {
      expect(l.code).toMatch(/^[a-z]{2,3}(-[A-Z][a-z]{3}|-[A-Z]{2})?$/);
      expect(l.nativeName.trim()).not.toBe("");
    }
  });

  it("includes the major game targets", () => {
    for (const code of ["en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "tr", "ja", "ko", "zh-Hans", "zh-Hant", "yue", "hi", "ar", "arz", "id", "vi", "el", "he", "cs", "hu", "ro", "da", "nb", "ca", "eu", "gl"]) {
      expect(getLanguage(code), code).toBeDefined();
    }
  });

  it("leaves out Flash-only TTS languages", () => {
    for (const code of ["fi", "sv", "th", "sw", "lt", "sl", "my"]) expect(getLanguage(code), code).toBeUndefined();
  });

  it("features exactly EN ES FR DE IT PT JA", () => {
    expect(FEATURED_LANGUAGE_CODES).toEqual(["en", "es", "fr", "de", "it", "pt", "ja"]);
    expect(LANGUAGES.filter((l) => l.tier === "featured").map((l) => l.code).sort()).toEqual([...FEATURED_LANGUAGE_CODES].sort());
  });

  it("derives romanization and direction from the script", () => {
    expect(getLanguage("ja")?.romanization).toBe("romaji");
    expect(getLanguage("zh-Hans")?.romanization).toBe("pinyin");
    expect(getLanguage("zh-Hant")?.romanization).toBe("pinyin");
    expect(getLanguage("ko")?.romanization).toBe("rr");
    for (const code of ["ar", "ru", "el", "he", "hi", "yue"]) expect(getLanguage(code)?.romanization, code).toBe("translit");
    for (const l of LANGUAGES) {
      expect(l.romanization === null, l.code).toBe(l.script === "Latn");
      expect(l.rtl, l.code).toBe(l.script === "Arab" || l.script === "Hebr");
    }
    expect(getLanguage("ar-Latn")?.rtl).toBe(false);
  });

  it("looks codes up case-insensitively but validates canonical casing", () => {
    expect(getLanguage("ZH-hant")?.code).toBe("zh-Hant");
    expect(getLanguage(" en ")?.code).toBe("en");
    expect(isLanguageCode("zh-Hant")).toBe(true);
    expect(isLanguageCode("zh-hant")).toBe(false);
    expect(isLanguageCode(42)).toBe(false);
    expect(LanguageCodeSchema.safeParse("ja").success).toBe(true);
    expect(LanguageCodeSchema.safeParse("klingon").success).toBe(false);
  });

  it("orders the picker featured first, then by English name", () => {
    const picker = languagesForPicker();
    expect(picker).toHaveLength(LANGUAGES.length);
    expect(picker.slice(0, 7).map((l) => l.code)).toEqual([...FEATURED_LANGUAGE_CODES]);
    const rest = picker.slice(7).map((l) => l.englishName);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, "en")));
  });
});
