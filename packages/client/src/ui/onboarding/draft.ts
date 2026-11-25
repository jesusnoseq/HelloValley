import {
  type AnimalId,
  ANIMALS,
  type ClothingColor,
  defaultStyleFor,
  getAnimal,
  getLanguage,
  type Hsl,
  type Language,
  languagesForPicker,
  OnboardingRequestSchema,
  type OnboardingRequestInput,
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_NAME_MIN_LENGTH,
  type SelfAssessment,
  type StyleId,
} from "@hellovalley/shared";
import type { MessageKey } from "../../i18n/i18n";

/**
 * The onboarding wizard's state (GDD §2.1, build plan M14), kept pure so it is unit-tested:
 * native language → target language → self-assessed level → character → town style, then the
 * server call and the apartment reveal.
 */

export const ONBOARDING_STEPS = ["native", "target", "level", "character", "style"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingDraft {
  nativeLang: string | null;
  targetLang: string | null;
  selfAssessment: SelfAssessment | null;
  name: string;
  animal: AnimalId;
  fur: string;
  shirt: ClothingColor;
  trousers: ClothingColor;
  style: StyleId | null;
  /** The player picked a style themselves: changing the target language no longer resets it. */
  styleChosen: boolean;
}

/** The supported language a browser tag names (`es-MX` → es, `zh-TW` → none), if any. */
export function languageFromBrowserTag(tag: string): Language | undefined {
  const parts = tag.trim().split(/[-_]/);
  for (let n = parts.length; n > 0; n--) {
    const language = getLanguage(parts.slice(0, n).join("-"));
    if (language) return language;
  }
  return undefined;
}

/** A fresh draft. The native language is guessed from the browser (`navigator.languages`). */
export function initialDraft(browserLanguages: readonly string[] = []): OnboardingDraft {
  const native = browserLanguages.map(languageFromBrowserTag).find((l) => l !== undefined);
  const animal = ANIMALS[0];
  return {
    nativeLang: native?.code ?? null,
    targetLang: null,
    selfAssessment: null,
    name: "",
    animal: animal.id,
    fur: animal.furTints[0].id,
    shirt: { swatch: "sky" },
    trousers: { swatch: "navy" },
    style: null,
    styleChosen: false,
  };
}

export function setNativeLang(d: OnboardingDraft, code: string): OnboardingDraft {
  // The target must differ from the native language (GDD §2.1 step 3).
  return { ...d, nativeLang: code, targetLang: d.targetLang === code ? null : d.targetLang };
}

/** Choosing the target language pre-selects its town style (GDD §7.3) unless one was chosen. */
export function setTargetLang(d: OnboardingDraft, code: string): OnboardingDraft {
  if (code === d.nativeLang) return d;
  return { ...d, targetLang: code, style: d.styleChosen && d.style ? d.style : defaultStyleFor(code) };
}

export function setStyle(d: OnboardingDraft, style: StyleId): OnboardingDraft {
  return { ...d, style, styleChosen: true };
}

/** Switching animal keeps the fur tint only if the new animal has one with the same id. */
export function setAnimal(d: OnboardingDraft, animal: AnimalId): OnboardingDraft {
  const def = getAnimal(animal);
  if (!def) return d;
  const fur = def.furTints.some((t) => t.id === d.fur) ? d.fur : def.furTints[0]!.id;
  return { ...d, animal, fur };
}

/** The animal `delta` places along the carousel, wrapping around. */
export function cycleAnimal(current: AnimalId, delta: number): AnimalId {
  const i = ANIMALS.findIndex((a) => a.id === current);
  const n = ANIMALS.length;
  return ANIMALS[(((i + delta) % n) + n) % n]!.id;
}

/** Client-side name check, mirroring PlayerNameSchema (the server also moderates the name). */
export function nameError(name: string): MessageKey | null {
  const trimmed = name.trim();
  if (trimmed.length < PLAYER_NAME_MIN_LENGTH) return "onboarding.name.tooShort";
  if (trimmed.length > PLAYER_NAME_MAX_LENGTH) return "onboarding.name.tooLong";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(trimmed)) return "onboarding.name.invalid";
  return null;
}

/** Why the player cannot leave `step` yet, or null. */
export function stepError(step: OnboardingStep, d: OnboardingDraft): MessageKey | null {
  switch (step) {
    case "native":
      return d.nativeLang ? null : "onboarding.lang.required";
    case "target":
      return d.targetLang && d.targetLang !== d.nativeLang ? null : "onboarding.lang.required";
    case "level":
      return d.selfAssessment ? null : "onboarding.level.required";
    case "character":
      return nameError(d.name);
    case "style":
      return d.style ? null : "onboarding.error.generic";
  }
}

/** The `POST /api/onboarding` body, or null while the draft is incomplete or invalid. */
export function toRequest(d: OnboardingDraft): OnboardingRequestInput | null {
  if (!d.nativeLang || !d.targetLang || !d.selfAssessment || !d.style) return null;
  const request: OnboardingRequestInput = {
    name: d.name.trim(),
    nativeLang: d.nativeLang,
    targetLang: d.targetLang,
    selfAssessment: d.selfAssessment,
    animal: d.animal,
    colors: { fur: d.fur, shirt: d.shirt, trousers: d.trousers },
    style: d.style,
  };
  return OnboardingRequestSchema.safeParse(request).success ? request : null;
}

export function isCustomColor(c: ClothingColor): c is Hsl {
  return !("swatch" in c);
}

/** Folds case and accents so "espanol" finds "Español" and "japones" finds "japonés". */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export interface PickerLanguage {
  language: Language;
  /** The name in the UI language (Intl.DisplayNames), e.g. "japonés". */
  displayName: string;
}

/**
 * The picker list (featured first, then the rest by English name, from `languagesForPicker`),
 * minus `exclude`, filtered by `query` against the native, English and localised names and code.
 */
export function filterLanguages(
  query: string,
  displayName: (l: Language) => string,
  exclude: string | null = null,
): PickerLanguage[] {
  const q = foldForSearch(query);
  return languagesForPicker()
    .filter((l) => l.code !== exclude)
    .map((language) => ({ language, displayName: displayName(language) }))
    .filter(({ language: l, displayName: shown }) =>
      q === "" ? true : [l.nativeName, l.englishName, shown, l.code].some((s) => foldForSearch(s).includes(q)),
    );
}
