import { describe, expect, it } from "vitest";
import { LANGUAGES } from "./languages";
import { defaultStyleFor, FALLBACK_STYLE, isStyleId, STYLE_IDS, StyleIdSchema, STYLES, type StyleId } from "./styles";

describe("styles", () => {
  it("has the four GDD §7.3 styles", () => {
    expect(STYLE_IDS).toEqual(["european", "mediterranean", "arabic", "japanese"]);
    for (const id of STYLE_IDS) expect(STYLES[id].id).toBe(id);
    expect(isStyleId("arabic")).toBe(true);
    expect(isStyleId("nordic")).toBe(false);
    expect(isStyleId(undefined)).toBe(false);
    expect(StyleIdSchema.safeParse("japanese").success).toBe(true);
  });
});

describe("defaultStyleFor (GDD §7.3)", () => {
  // Every language the GDD table names, by its code in the registry.
  const GDD_DEFAULTS: Record<StyleId, string[]> = {
    european: ["de", "nl", "en", "fr", "pl", "cs", "da", "nb", "nn", "hu", "ru", "be", "bg", "bs", "hr", "mk", "sr", "sk", "lv", "et", "is"],
    mediterranean: ["es", "it", "pt", "el", "ca", "gl", "eu", "mt", "ro"],
    arabic: ["ar", "arz", "ar-Latn", "fa", "fa-AF", "tr", "he", "ckb", "pa", "ha"],
    japanese: ["ja", "ko", "zh-Hans", "zh-Hant", "yue", "vi", "mn"],
  };

  for (const [style, codes] of Object.entries(GDD_DEFAULTS)) {
    it(`maps ${codes.join(", ")} to ${style}`, () => {
      for (const code of codes) expect(defaultStyleFor(code), code).toBe(style);
    });
  }

  it("uses Mediterranean for languages without an obvious match", () => {
    expect(FALLBACK_STYLE).toBe("mediterranean");
    for (const code of ["hi", "id", "bn", "ta", "am", "fil"]) expect(defaultStyleFor(code), code).toBe("mediterranean");
  });

  it("falls back to Mediterranean for unknown or empty codes", () => {
    expect(defaultStyleFor("sw")).toBe("mediterranean"); // Swahili is Flash-only TTS, not in the registry.
    expect(defaultStyleFor("xx")).toBe("mediterranean");
    expect(defaultStyleFor("")).toBe("mediterranean");
  });

  it("strips region and extra subtags, case-insensitively", () => {
    expect(defaultStyleFor("pt-BR")).toBe("mediterranean");
    expect(defaultStyleFor("en_GB")).toBe("european");
    expect(defaultStyleFor("JA")).toBe("japanese");
    expect(defaultStyleFor("zh-hant-TW")).toBe("japanese");
    expect(defaultStyleFor("ar-EG")).toBe("arabic");
    expect(defaultStyleFor(" de ")).toBe("european");
  });

  it("returns each registry language's own default", () => {
    for (const language of LANGUAGES) {
      expect(isStyleId(language.defaultStyle)).toBe(true);
      expect(defaultStyleFor(language.code)).toBe(language.defaultStyle);
    }
  });
});
