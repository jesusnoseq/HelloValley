import { TokenizedLineSchema, type TokenizedLine, type TokenizedLineInput } from "@hellovalley/shared";

/**
 * Speech bubble fixtures (build plan M19): EN ES JA ZH KO AR RU, plus HE and FA for the other
 * right-to-left scripts. Used by the /dev/speech page and the component tests. Glosses and
 * translations are in English (Spanish for the English fixture).
 */
export interface SpeechFixture {
  id: string;
  title: string;
  lang: string;
  nativeLang: string;
  speaker: string;
  lines: TokenizedLine[];
}

interface FixtureInput extends Omit<SpeechFixture, "lines"> {
  lines: TokenizedLineInput[];
}

const p = (surface: string) => ({ surface, gloss: "", pos: "punct" as const });

const INPUT: FixtureInput[] = [
  {
    id: "en",
    title: "English (native: Spanish)",
    lang: "en",
    nativeLang: "es",
    speaker: "Baker",
    lines: [
      {
        text: "Good morning! The bread is still warm.",
        translation: "¡Buenos días! El pan todavía está caliente.",
        tokens: [
          { surface: "Good", lemma: "good", gloss: "buen(o)", pos: "adj" },
          { surface: "morning", lemma: "morning", gloss: "mañana", pos: "noun" },
          p("!"),
          { surface: "The", lemma: "the", gloss: "el / la", pos: "other" },
          { surface: "bread", lemma: "bread", gloss: "pan", pos: "noun" },
          { surface: "is", lemma: "be", gloss: "está", pos: "verb" },
          { surface: "still", lemma: "still", gloss: "todavía", pos: "adv" },
          { surface: "warm", lemma: "warm", gloss: "caliente", pos: "adj" },
          p("."),
        ],
      },
    ],
  },
  {
    id: "es",
    title: "Spanish",
    lang: "es",
    nativeLang: "en",
    speaker: "Barista",
    lines: [
      {
        text: "¿Quieres un café con leche?",
        translation: "Do you want a coffee with milk?",
        tokens: [
          p("¿"),
          { surface: "Quieres", lemma: "querer", gloss: "you want", pos: "verb" },
          { surface: "un", lemma: "uno", gloss: "a", pos: "other" },
          { surface: "café", gloss: "coffee", pos: "noun" },
          { surface: "con", gloss: "with", pos: "prep" },
          { surface: "leche", gloss: "milk", pos: "noun" },
          p("?"),
        ],
      },
      {
        text: "Hoy hace sol.",
        translation: "It's sunny today.",
        tokens: [
          { surface: "Hoy", lemma: "hoy", gloss: "today", pos: "adv" },
          { surface: "hace", lemma: "hacer", gloss: "it is (weather)", pos: "verb" },
          { surface: "sol", gloss: "sun", pos: "noun" },
          p("."),
        ],
      },
    ],
  },
  {
    id: "ja",
    title: "Japanese",
    lang: "ja",
    nativeLang: "en",
    speaker: "Baker",
    lines: [
      {
        text: "おはようございます！パンを食べますか？",
        reading: "ohayō gozaimasu! pan o tabemasu ka?",
        translation: "Good morning! Will you have some bread?",
        tokens: [
          { surface: "おはようございます", romanized: "ohayō gozaimasu", gloss: "good morning", pos: "interj" },
          p("！"),
          { surface: "パン", reading: "パン", romanized: "pan", gloss: "bread", pos: "noun" },
          { surface: "を", reading: "を", romanized: "o", gloss: "(object marker)", pos: "particle" },
          { surface: "食べます", lemma: "食べる", reading: "たべます", romanized: "tabemasu", gloss: "eat", pos: "verb" },
          { surface: "か", reading: "か", romanized: "ka", gloss: "(question)", pos: "particle" },
          p("？"),
        ],
      },
      {
        text: "今日は東京から来ました。",
        translation: "Today I came from Tokyo.",
        tokens: [
          { surface: "今日", reading: "きょう", romanized: "kyō", gloss: "today", pos: "noun" },
          { surface: "は", reading: "は", gloss: "(topic marker)", pos: "particle" },
          { surface: "東京", reading: "とうきょう", romanized: "Tōkyō", gloss: "Tokyo", pos: "noun" },
          { surface: "から", reading: "から", gloss: "from", pos: "particle" },
          { surface: "来ました", lemma: "来る", reading: "きました", gloss: "came", pos: "verb" },
          p("。"),
        ],
      },
      {
        // No `romanized` fields: the romaji comes from the kana readings.
        text: "お茶もどうぞ。",
        translation: "Please have some tea too.",
        tokens: [
          { surface: "お茶", reading: "おちゃ", gloss: "tea", pos: "noun" },
          { surface: "も", gloss: "also", pos: "particle" },
          { surface: "どうぞ", gloss: "please, go ahead", pos: "adv" },
          p("。"),
        ],
      },
    ],
  },
  {
    id: "zh",
    title: "Chinese (Simplified)",
    lang: "zh-Hans",
    nativeLang: "en",
    speaker: "Shopkeeper",
    lines: [
      {
        text: "你好！我想买一个面包。",
        translation: "Hello! I'd like to buy a loaf of bread.",
        tokens: [
          { surface: "你好", reading: "nǐ hǎo", gloss: "hello", pos: "interj" },
          p("！"),
          { surface: "我", reading: "wǒ", gloss: "I", pos: "pron" },
          { surface: "想", reading: "xiǎng", gloss: "would like", pos: "verb" },
          { surface: "买", reading: "mǎi", gloss: "buy", pos: "verb" },
          { surface: "一个", reading: "yí gè", gloss: "one (measure word)", pos: "num" },
          { surface: "面包", reading: "miànbāo", gloss: "bread", pos: "noun" },
          p("。"),
        ],
      },
    ],
  },
  {
    id: "ko",
    title: "Korean",
    lang: "ko",
    nativeLang: "en",
    speaker: "Doctor",
    lines: [
      {
        text: "안녕하세요! 빵 하나 주세요.",
        translation: "Hello! One bread, please.",
        tokens: [
          { surface: "안녕하세요", reading: "annyeonghaseyo", gloss: "hello", pos: "interj" },
          p("!"),
          { surface: "빵", reading: "ppang", gloss: "bread", pos: "noun" },
          { surface: "하나", reading: "hana", gloss: "one", pos: "num" },
          { surface: "주세요", lemma: "주다", reading: "juseyo", gloss: "please give", pos: "verb" },
          p("."),
        ],
      },
    ],
  },
  {
    id: "ar",
    title: "Arabic",
    lang: "ar",
    nativeLang: "en",
    speaker: "Gossip",
    lines: [
      {
        text: "مرحبا! هل تريد قهوة؟",
        translation: "Hello! Do you want coffee?",
        tokens: [
          { surface: "مرحبا", reading: "marḥaban", gloss: "hello", pos: "interj" },
          p("!"),
          { surface: "هل", reading: "hal", gloss: "(question)", pos: "particle" },
          { surface: "تريد", lemma: "أراد", reading: "turīd", gloss: "you want", pos: "verb" },
          { surface: "قهوة", reading: "qahwa", gloss: "coffee", pos: "noun" },
          p("؟"),
        ],
      },
    ],
  },
  {
    id: "ru",
    title: "Russian",
    lang: "ru",
    nativeLang: "en",
    speaker: "Farmer",
    lines: [
      {
        text: "Доброе утро! Хлеб ещё тёплый.",
        translation: "Good morning! The bread is still warm.",
        tokens: [
          { surface: "Доброе", lemma: "добрый", reading: "dobroye", gloss: "good", pos: "adj" },
          { surface: "утро", reading: "utro", gloss: "morning", pos: "noun" },
          p("!"),
          { surface: "Хлеб", lemma: "хлеб", reading: "khleb", gloss: "bread", pos: "noun" },
          { surface: "ещё", reading: "yeshchyo", gloss: "still", pos: "adv" },
          { surface: "тёплый", reading: "tyoplyy", gloss: "warm", pos: "adj" },
          p("."),
        ],
      },
    ],
  },
  {
    id: "he",
    title: "Hebrew",
    lang: "he",
    nativeLang: "en",
    speaker: "Librarian",
    lines: [
      {
        text: "שלום! הלחם טרי.",
        translation: "Hello! The bread is fresh.",
        tokens: [
          { surface: "שלום", reading: "shalom", gloss: "hello", pos: "interj" },
          p("!"),
          { surface: "הלחם", lemma: "לחם", reading: "halekhem", gloss: "the bread", pos: "noun" },
          { surface: "טרי", reading: "tari", gloss: "fresh", pos: "adj" },
          p("."),
        ],
      },
    ],
  },
  {
    id: "fa",
    title: "Persian",
    lang: "fa",
    nativeLang: "en",
    speaker: "Elder",
    lines: [
      {
        text: "سلام! چای می‌خواهید؟",
        translation: "Hello! Would you like tea?",
        tokens: [
          { surface: "سلام", reading: "salām", gloss: "hello", pos: "interj" },
          p("!"),
          { surface: "چای", reading: "chāy", gloss: "tea", pos: "noun" },
          { surface: "می‌خواهید", lemma: "خواستن", reading: "mikhāhid", gloss: "you want", pos: "verb" },
          p("؟"),
        ],
      },
    ],
  },
];

export const SPEECH_FIXTURES: readonly SpeechFixture[] = INPUT.map((f) => ({
  ...f,
  lines: f.lines.map((l) => TokenizedLineSchema.parse(l)),
}));

/** The languages build plan M19 requires fixtures for. */
export const REQUIRED_FIXTURE_IDS = ["en", "es", "ja", "zh", "ko", "ar", "ru"] as const;
