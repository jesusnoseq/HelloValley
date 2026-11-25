import { ANIMAL_IDS, SELF_ASSESSMENT_IDS, STYLE_IDS, SWATCH_IDS } from "@hellovalley/shared";
import { describe, expect, it } from "vitest";
import {
  catalogFor,
  FALLBACK_LOCALE,
  interpolate,
  languageDisplayName,
  type MessageKey,
  placeholders,
  translate,
  UI_LOCALES,
  uiLocaleFor,
  uiLocaleFromBrowser,
} from "./i18n";
import { en } from "./messages.en";

const keys = Object.keys(en) as MessageKey[];

describe("catalogues", () => {
  it("ships EN and ES", () => {
    expect(UI_LOCALES).toEqual(["en", "es"]);
  });

  for (const locale of UI_LOCALES) {
    it(`${locale} has every key, no extra keys and the same placeholders as EN`, () => {
      const catalog = catalogFor(locale);
      expect(Object.keys(catalog).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        const text = catalog[key];
        expect(text?.trim(), key).toBeTruthy();
        expect(placeholders(text!), key).toEqual(placeholders(en[key]));
      }
    });
  }

  it("has a label for every animal, swatch, style and self-assessment", () => {
    const ids = [
      ...ANIMAL_IDS.map((id) => `animal.${id}`),
      ...SWATCH_IDS.map((id) => `swatch.${id}`),
      ...STYLE_IDS.flatMap((id) => [`style.${id}`, `style.${id}.desc`]),
      ...SELF_ASSESSMENT_IDS.map((id) => `level.${id}`),
    ];
    for (const id of ids) expect(keys, id).toContain(id);
  });
});

describe("uiLocaleFor", () => {
  it("uses the native language when a catalogue exists, by primary subtag", () => {
    expect(uiLocaleFor("es")).toBe("es");
    expect(uiLocaleFor("ES-mx")).toBe("es");
    expect(uiLocaleFor("en")).toBe("en");
  });

  it("falls back to English for other languages and missing values", () => {
    for (const lang of ["ja", "fr", "zh-Hant", "", null, undefined, "constructor", "__proto__"]) {
      expect(uiLocaleFor(lang)).toBe(FALLBACK_LOCALE);
    }
  });

  it("picks the first catalogued browser language", () => {
    expect(uiLocaleFromBrowser(["fr-FR", "es-ES", "en"])).toBe("es");
    expect(uiLocaleFromBrowser(["en-GB", "es"])).toBe("en");
    expect(uiLocaleFromBrowser(["ja"])).toBe("en");
    expect(uiLocaleFromBrowser([])).toBe("en");
  });
});

describe("translate", () => {
  it("translates and fills placeholders", () => {
    expect(translate("es", "common.next")).toBe("Siguiente");
    expect(translate("en", "hud.apartment", { apartment: "6D" })).toBe("Apartment 6D");
    expect(translate("es", "onboarding.progress", { step: 2, total: 5 })).toBe("Paso 2 de 5");
  });

  it("leaves unknown placeholders alone and ignores inherited properties", () => {
    expect(interpolate("Hi {name}, {other}", { name: "Lia" })).toBe("Hi Lia, {other}");
    expect(interpolate("{toString}", {})).toBe("{toString}");
  });
});

describe("languageDisplayName", () => {
  it("names languages in the UI language, with the registry name as fallback", () => {
    expect(languageDisplayName("ja", "en", "Japanese")).toBe("Japanese");
    expect(languageDisplayName("ja", "es", "Japanese").toLowerCase()).toBe("japonés");
    expect(languageDisplayName("zz-Fake", "en", "Fallback")).toBe("Fallback");
  });
});
