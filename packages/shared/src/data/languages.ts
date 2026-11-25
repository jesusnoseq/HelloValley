import { z } from "zod";
import type { StyleId } from "./styles";

/**
 * Target languages: every language `gemini-3.8-flash-lite-tts` supports, as listed in
 * docs/hellovalley-village-npcs.md ("Available TTS languages", full list). Languages that only the
 * Flash TTS model supports are left out.
 *
 * Codes are BCP 47 tags. A script subtag is added only where the list names a non-default script
 * (`ace-Arab`, `ks-Arab`, `ar-Latn`, `zh-Hant`, …).
 */

/** ISO 15924 script codes used by the supported languages. */
export type ScriptCode =
  | "Latn"
  | "Cyrl"
  | "Grek"
  | "Armn"
  | "Geor"
  | "Arab"
  | "Hebr"
  | "Ethi"
  | "Deva"
  | "Beng"
  | "Gujr"
  | "Guru"
  | "Orya"
  | "Knda"
  | "Mlym"
  | "Taml"
  | "Telu"
  | "Sinh"
  | "Olck"
  | "Khmr"
  | "Laoo"
  | "Jpan"
  | "Hans"
  | "Hant"
  | "Kore";

/** Reading shown under non-Latin text by the script toggle (GDD §6.1). `null` for Latin-script languages. */
export type Romanization = "romaji" | "pinyin" | "rr" | "translit" | null;

/** Featured languages get seeded caches and full QA; the rest are marked experimental in the UI. */
export type LanguageTier = "featured" | "experimental";

export interface Language {
  code: string;
  englishName: string;
  nativeName: string;
  script: ScriptCode;
  romanization: Romanization;
  rtl: boolean;
  defaultStyle: StyleId;
  tier: LanguageTier;
}

/** EN ES FR DE IT PT JA (build plan M02). */
export const FEATURED_LANGUAGE_CODES = ["en", "es", "fr", "de", "it", "pt", "ja"] as const;

const RTL_SCRIPTS: ReadonlySet<ScriptCode> = new Set(["Arab", "Hebr"]);

function romanizationFor(script: ScriptCode): Romanization {
  switch (script) {
    case "Latn":
      return null;
    case "Jpan":
      return "romaji";
    case "Hans":
    case "Hant":
      return "pinyin";
    case "Kore":
      return "rr";
    default:
      return "translit";
  }
}

function lang(
  code: string,
  englishName: string,
  nativeName: string,
  script: ScriptCode,
  defaultStyle: StyleId,
  overrides: Partial<Pick<Language, "romanization">> = {},
): Language {
  return {
    code,
    englishName,
    nativeName,
    script,
    romanization: overrides.romanization !== undefined ? overrides.romanization : romanizationFor(script),
    rtl: RTL_SCRIPTS.has(script),
    defaultStyle,
    tier: (FEATURED_LANGUAGE_CODES as readonly string[]).includes(code) ? "featured" : "experimental",
  };
}

// Style defaults follow GDD §7.3. Languages with no obvious match use "mediterranean".
export const LANGUAGES: readonly Language[] = [
  lang("ace-Arab", "Acehnese (Arabic script)", "بهسا اچيه", "Arab", "arabic"),
  lang("af", "Afrikaans", "Afrikaans", "Latn", "european"),
  lang("ak", "Akan", "Akan", "Latn", "mediterranean"),
  lang("am", "Amharic", "አማርኛ", "Ethi", "mediterranean"),
  lang("hy", "Armenian", "Հայերեն", "Armn", "mediterranean"),
  lang("as", "Assamese", "অসমীয়া", "Beng", "mediterranean"),
  lang("awa", "Awadhi", "अवधी", "Deva", "mediterranean"),
  lang("ban", "Balinese", "Basa Bali", "Latn", "mediterranean"),
  lang("bn", "Bangla", "বাংলা", "Beng", "mediterranean"),
  lang("bjn", "Banjar", "Bahasa Banjar", "Latn", "mediterranean"),
  lang("eu", "Basque", "Euskara", "Latn", "mediterranean"),
  lang("be", "Belarusian", "Беларуская", "Cyrl", "european"),
  lang("bho", "Bhojpuri", "भोजपुरी", "Deva", "mediterranean"),
  lang("bs", "Bosnian", "Bosanski", "Latn", "european"),
  lang("bug", "Buginese", "Basa Ugi", "Latn", "mediterranean"),
  lang("bg", "Bulgarian", "Български", "Cyrl", "european"),
  // Cantonese is read with Jyutping, which the toggle treats as a generic transliteration.
  lang("yue", "Cantonese", "粵語", "Hant", "japanese", { romanization: "translit" }),
  lang("ca", "Catalan", "Català", "Latn", "mediterranean"),
  lang("ceb", "Cebuano", "Cebuano", "Latn", "mediterranean"),
  lang("ckb", "Central Kurdish", "کوردیی ناوەندی", "Arab", "arabic"),
  lang("hne", "Chhattisgarhi", "छत्तीसगढ़ी", "Deva", "mediterranean"),
  lang("zh-Hans", "Chinese (Simplified)", "简体中文", "Hans", "japanese"),
  lang("zh-Hant", "Chinese (Traditional)", "繁體中文", "Hant", "japanese"),
  lang("hr", "Croatian", "Hrvatski", "Latn", "european"),
  lang("cs", "Czech", "Čeština", "Latn", "european"),
  lang("da", "Danish", "Dansk", "Latn", "european"),
  lang("nl", "Dutch", "Nederlands", "Latn", "european"),
  lang("arz", "Egyptian Arabic", "العربية المصرية", "Arab", "arabic"),
  lang("en", "English", "English", "Latn", "european"),
  lang("et", "Estonian", "Eesti", "Latn", "european"),
  lang("fil", "Filipino", "Filipino", "Latn", "mediterranean"),
  lang("fr", "French", "Français", "Latn", "european"),
  lang("gl", "Galician", "Galego", "Latn", "mediterranean"),
  lang("lg", "Ganda", "Luganda", "Latn", "mediterranean"),
  lang("ka", "Georgian", "ქართული", "Geor", "mediterranean"),
  lang("de", "German", "Deutsch", "Latn", "european"),
  lang("el", "Greek", "Ελληνικά", "Grek", "mediterranean"),
  lang("gu", "Gujarati", "ગુજરાતી", "Gujr", "mediterranean"),
  lang("ht", "Haitian Creole", "Kreyòl ayisyen", "Latn", "mediterranean"),
  lang("mn", "Halh Mongolian", "Монгол хэл", "Cyrl", "japanese"),
  lang("ha", "Hausa", "Hausa", "Latn", "arabic"),
  lang("he", "Hebrew", "עברית", "Hebr", "arabic"),
  lang("hi", "Hindi", "हिन्दी", "Deva", "mediterranean"),
  lang("hu", "Hungarian", "Magyar", "Latn", "european"),
  lang("is", "Icelandic", "Íslenska", "Latn", "european"),
  lang("ilo", "Iloko", "Ilokano", "Latn", "mediterranean"),
  lang("id", "Indonesian", "Bahasa Indonesia", "Latn", "mediterranean"),
  lang("fa", "Iranian Persian", "فارسی", "Arab", "arabic"),
  lang("it", "Italian", "Italiano", "Latn", "mediterranean"),
  lang("ja", "Japanese", "日本語", "Jpan", "japanese"),
  lang("jv", "Javanese", "Basa Jawa", "Latn", "mediterranean"),
  lang("kam", "Kamba", "Kikamba", "Latn", "mediterranean"),
  lang("kn", "Kannada", "ಕನ್ನಡ", "Knda", "mediterranean"),
  lang("ks-Arab", "Kashmiri (Arabic script)", "کٲشُر", "Arab", "arabic"),
  lang("ks-Deva", "Kashmiri (Devanagari script)", "कॉशुर", "Deva", "arabic"),
  lang("kk", "Kazakh", "Қазақ тілі", "Cyrl", "mediterranean"),
  lang("km", "Khmer", "ខ្មែរ", "Khmr", "mediterranean"),
  lang("ki", "Kikuyu", "Gĩkũyũ", "Latn", "mediterranean"),
  lang("rw", "Kinyarwanda", "Ikinyarwanda", "Latn", "mediterranean"),
  lang("kg", "Kongo", "Kikongo", "Latn", "mediterranean"),
  lang("ko", "Korean", "한국어", "Kore", "japanese"),
  lang("ky", "Kyrgyz", "Кыргызча", "Cyrl", "mediterranean"),
  lang("lo", "Lao", "ລາວ", "Laoo", "mediterranean"),
  lang("ln", "Lingala", "Lingála", "Latn", "mediterranean"),
  lang("mk", "Macedonian", "Македонски", "Cyrl", "european"),
  lang("mag", "Magahi", "मगही", "Deva", "mediterranean"),
  lang("mai", "Maithili", "मैथिली", "Deva", "mediterranean"),
  lang("ml", "Malayalam", "മലയാളം", "Mlym", "mediterranean"),
  lang("mt", "Maltese", "Malti", "Latn", "mediterranean"),
  lang("mni", "Manipuri", "মৈতৈলোন্", "Beng", "mediterranean"),
  lang("mr", "Marathi", "मराठी", "Deva", "mediterranean"),
  lang("min-Arab", "Minangkabau (Arabic script)", "باسو مينڠكاباو", "Arab", "arabic"),
  lang("lus", "Mizo", "Mizo ṭawng", "Latn", "mediterranean"),
  lang("ne", "Nepali", "नेपाली", "Deva", "mediterranean"),
  lang("fuv", "Nigerian Fulfulde", "Fulfulde", "Latn", "mediterranean"),
  lang("az", "North Azerbaijani", "Azərbaycan dili", "Latn", "arabic"),
  lang("nso", "Northern Sotho", "Sesotho sa Leboa", "Latn", "mediterranean"),
  lang("uz", "Northern Uzbek", "Oʻzbekcha", "Latn", "arabic"),
  lang("nb", "Norwegian Bokmål", "Norsk bokmål", "Latn", "european"),
  lang("nn", "Norwegian Nynorsk", "Norsk nynorsk", "Latn", "european"),
  lang("ny", "Nyanja", "Chinyanja", "Latn", "mediterranean"),
  lang("or", "Odia", "ଓଡ଼ିଆ", "Orya", "mediterranean"),
  lang("fa-AF", "Persian (Afghanistan)", "دری", "Arab", "arabic"),
  lang("pl", "Polish", "Polski", "Latn", "european"),
  lang("pt", "Portuguese", "Português", "Latn", "mediterranean"),
  lang("pa", "Punjabi", "ਪੰਜਾਬੀ", "Guru", "arabic"),
  lang("ro", "Romanian", "Română", "Latn", "mediterranean"),
  lang("ru", "Russian", "Русский", "Cyrl", "european"),
  lang("sat", "Santali", "ᱥᱟᱱᱛᱟᱲᱤ", "Olck", "mediterranean"),
  lang("sr", "Serbian", "Српски", "Cyrl", "european"),
  lang("si", "Sinhala", "සිංහල", "Sinh", "mediterranean"),
  lang("sk", "Slovak", "Slovenčina", "Latn", "european"),
  lang("azb", "South Azerbaijani", "تۆرکجه", "Arab", "arabic"),
  lang("ps", "Southern Pashto", "پښتو", "Arab", "arabic"),
  lang("es", "Spanish", "Español", "Latn", "mediterranean"),
  lang("ar", "Standard Arabic", "العربية", "Arab", "arabic"),
  lang("ar-Latn", "Standard Arabic (Latin script)", "al-ʿArabiyya", "Latn", "arabic"),
  lang("lv", "Standard Latvian", "Latviešu", "Latn", "european"),
  lang("ms", "Standard Malay", "Bahasa Melayu", "Latn", "mediterranean"),
  lang("ta", "Tamil", "தமிழ்", "Taml", "mediterranean"),
  lang("te", "Telugu", "తెలుగు", "Telu", "mediterranean"),
  lang("tr", "Turkish", "Türkçe", "Latn", "arabic"),
  lang("vi", "Vietnamese", "Tiếng Việt", "Latn", "japanese"),
];

export const LANGUAGE_CODES: readonly string[] = LANGUAGES.map((l) => l.code);

// BCP 47 tags are case-insensitive, so lookups are too.
const BY_CODE: ReadonlyMap<string, Language> = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));

export function getLanguage(code: string): Language | undefined {
  return BY_CODE.get(code.trim().toLowerCase());
}

export function isLanguageCode(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE_CODES.includes(value);
}

/** A supported language code, in its canonical casing. */
export const LanguageCodeSchema = z.string().refine(isLanguageCode, { message: "unsupported language code" });

/** Featured languages first (in FEATURED_LANGUAGE_CODES order), then the rest by English name. */
export function languagesForPicker(): Language[] {
  const featured = FEATURED_LANGUAGE_CODES.map((code) => BY_CODE.get(code)).filter(
    (l): l is Language => l !== undefined,
  );
  const rest = LANGUAGES.filter((l) => l.tier === "experimental").sort((a, b) =>
    a.englishName.localeCompare(b.englishName, "en"),
  );
  return [...featured, ...rest];
}
