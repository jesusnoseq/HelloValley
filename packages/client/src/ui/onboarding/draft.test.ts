import { ANIMALS, FEATURED_LANGUAGE_CODES, OnboardingRequestSchema } from "@hellovalley/shared";
import { describe, expect, it } from "vitest";
import {
  cycleAnimal,
  filterLanguages,
  initialDraft,
  languageFromBrowserTag,
  nameError,
  ONBOARDING_STEPS,
  type OnboardingDraft,
  setAnimal,
  setNativeLang,
  setStyle,
  setTargetLang,
  stepError,
  toRequest,
} from "./draft";

const english = (l: { englishName: string }) => l.englishName;

function complete(): OnboardingDraft {
  let d = setNativeLang(initialDraft(), "es");
  d = setTargetLang(d, "ja");
  return { ...d, selfAssessment: "basics", name: " Lia " };
}

describe("initialDraft", () => {
  it("guesses the native language from the browser", () => {
    expect(initialDraft(["es-MX", "en"]).nativeLang).toBe("es");
    expect(initialDraft(["xx", "pt-BR"]).nativeLang).toBe("pt");
    expect(initialDraft([]).nativeLang).toBeNull();
    expect(languageFromBrowserTag("zh-Hant-TW")?.code).toBe("zh-Hant");
  });

  it("starts with a valid look", () => {
    const d = initialDraft();
    expect(ANIMALS.find((a) => a.id === d.animal)?.furTints.map((t) => t.id)).toContain(d.fur);
  });
});

describe("language steps", () => {
  it("pre-selects the town style from the target language", () => {
    const d = setTargetLang(setNativeLang(initialDraft(), "en"), "ja");
    expect(d.style).toBe("japanese");
    expect(setTargetLang(d, "it").style).toBe("mediterranean");
  });

  it("keeps a style the player chose", () => {
    const d = setStyle(setTargetLang(setNativeLang(initialDraft(), "en"), "ja"), "european");
    expect(setTargetLang(d, "it").style).toBe("european");
  });

  it("never lets the target equal the native language", () => {
    const d = setTargetLang(setNativeLang(initialDraft(), "en"), "es");
    expect(setTargetLang(d, "en").targetLang).toBe("es");
    expect(setNativeLang(d, "es").targetLang).toBeNull();
    expect(stepError("target", setNativeLang(d, "es"))).toBe("onboarding.lang.required");
  });
});

describe("filterLanguages", () => {
  it("lists featured languages first and excludes the native one", () => {
    const all = filterLanguages("", english, "en");
    expect(all.slice(0, FEATURED_LANGUAGE_CODES.length - 1).map((l) => l.language.code)).toEqual(
      FEATURED_LANGUAGE_CODES.filter((c) => c !== "en"),
    );
    expect(all.some((l) => l.language.code === "en")).toBe(false);
  });

  it("matches native, English and localised names, ignoring case and accents", () => {
    expect(filterLanguages("espanol", english).map((l) => l.language.code)).toContain("es");
    expect(filterLanguages("JAPAN", english).map((l) => l.language.code)).toContain("ja");
    expect(filterLanguages("日本", english).map((l) => l.language.code)).toEqual(["ja"]);
    expect(filterLanguages("japones", () => "japonés").length).toBeGreaterThan(0);
    expect(filterLanguages("qqqq", english)).toEqual([]);
  });
});

describe("character", () => {
  it("checks the name like the shared schema", () => {
    expect(nameError("A")).toBe("onboarding.name.tooShort");
    expect(nameError("   ")).toBe("onboarding.name.tooShort");
    expect(nameError("x".repeat(17))).toBe("onboarding.name.tooLong");
    expect(nameError("Li\u0007a")).toBe("onboarding.name.invalid");
    expect(nameError("  Lia ")).toBeNull();
  });

  it("keeps the fur tint only when the new animal has it", () => {
    const d = { ...initialDraft(), animal: "cat" as const, fur: "grey" };
    expect(setAnimal(d, "koala").fur).toBe("grey");
    expect(setAnimal(d, "frog").fur).toBe("leaf");
  });

  it("cycles through all 16 animals in both directions", () => {
    expect(cycleAnimal("fox", -1)).toBe(ANIMALS[ANIMALS.length - 1]!.id);
    expect(cycleAnimal(ANIMALS[ANIMALS.length - 1]!.id, 1)).toBe("fox");
    let a = ANIMALS[0].id as (typeof ANIMALS)[number]["id"];
    const seen = new Set<string>();
    for (let i = 0; i < ANIMALS.length; i++) {
      seen.add(a);
      a = cycleAnimal(a, 1);
    }
    expect(seen.size).toBe(16);
  });
});

describe("toRequest", () => {
  it("is null until every step is done", () => {
    expect(toRequest(initialDraft(["en"]))).toBeNull();
    for (const step of ONBOARDING_STEPS) expect(stepError(step, complete()), step).toBeNull();
  });

  it("builds a request the server schema accepts", () => {
    const req = toRequest({ ...complete(), trousers: { h: 500, s: 2, l: -1 } });
    expect(req).toMatchObject({ name: "Lia", nativeLang: "es", targetLang: "ja", style: "japanese" });
    expect(OnboardingRequestSchema.safeParse(req).success).toBe(true);
  });

  it("is null for an invalid name", () => {
    expect(toRequest({ ...complete(), name: "x" })).toBeNull();
  });
});
