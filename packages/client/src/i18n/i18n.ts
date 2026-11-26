import { type Catalog, en, type MessageKey } from "./messages.en";
import { es } from "./messages.es";

/**
 * The UI string system (build plan M14): the UI is shown in the player's native language when a
 * catalogue exists for it, else in English; a key missing from a catalogue falls back to English.
 * No shared imports here: this module is in the entry chunk (shared values pull in zod).
 * TODO(backlog): more UI languages (start with the featured ones: FR DE IT PT JA).
 */

export type { MessageKey } from "./messages.en";

const CATALOGS = { en, es } as const satisfies Record<string, Partial<Catalog>>;
export type UiLocale = keyof typeof CATALOGS;
export const UI_LOCALES = Object.keys(CATALOGS) as UiLocale[];
export const FALLBACK_LOCALE: UiLocale = "en";

export type MessageParams = Readonly<Record<string, string | number>>;
export type Translate = (key: MessageKey, params?: MessageParams) => string;

function isUiLocale(value: string): value is UiLocale {
  return Object.hasOwn(CATALOGS, value);
}

/** The UI language for a native language tag: its primary subtag if catalogued (`es-MX` → es), else EN. */
export function uiLocaleFor(lang: string | null | undefined): UiLocale {
  const primary = (lang ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isUiLocale(primary) ? primary : FALLBACK_LOCALE;
}

/** The first catalogued browser language (`navigator.languages`), else EN. */
export function uiLocaleFromBrowser(languages: readonly string[]): UiLocale {
  for (const lang of languages) {
    const locale = uiLocaleFor(lang);
    if (locale !== FALLBACK_LOCALE || lang.toLowerCase().startsWith(FALLBACK_LOCALE)) return locale;
  }
  return FALLBACK_LOCALE;
}

/** Fills `{name}` placeholders; unknown placeholders stay as written. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export function translate(locale: UiLocale, key: MessageKey, params?: MessageParams): string {
  const catalog: Partial<Catalog> = CATALOGS[locale];
  return interpolate(catalog[key] ?? en[key] ?? key, params);
}

export function createTranslator(locale: UiLocale): Translate {
  return (key, params) => translate(locale, key, params);
}

/** Placeholder names used in a template (`{name}`), sorted. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

export function catalogFor(locale: UiLocale): Partial<Catalog> {
  return CATALOGS[locale];
}

const displayNames = new Map<UiLocale, Intl.DisplayNames | null>();

/**
 * A language's name in the UI language (`ja` → "Japanese" / "japonés") from `Intl.DisplayNames`,
 * or `fallback` (the registry's English name) where the browser has none.
 */
export function languageDisplayName(code: string, locale: UiLocale, fallback: string): string {
  if (!displayNames.has(locale)) {
    try {
      displayNames.set(locale, new Intl.DisplayNames([locale], { type: "language", fallback: "none" }));
    } catch {
      displayNames.set(locale, null);
    }
  }
  try {
    const name = displayNames.get(locale)?.of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? name : fallback;
  } catch {
    return fallback;
  }
}
