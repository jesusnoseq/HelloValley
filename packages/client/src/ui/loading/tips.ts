/**
 * Cozy tips for the preloading screen (build plan M37), written by hand in the featured languages
 * (EN ES FR DE IT PT JA, GDD §6) at a beginner's level, so a learner can read them while the town
 * loads. A target language without tips shows the tip in the UI language only. The non-English
 * texts were not reviewed by native speakers (pending.md, M37). Pure data, no shared imports (the
 * loading screen is in the entry chunk).
 */

export const TIP_LANGS = ["en", "es", "fr", "de", "it", "pt", "ja"] as const;
export type TipLang = (typeof TIP_LANGS)[number];

export type Tip = Readonly<Record<TipLang, string>>;

export const LOADING_TIPS: readonly Tip[] = [
  {
    en: "Click a word to save it in your notebook.",
    es: "Haz clic en una palabra para guardarla en tu cuaderno.",
    fr: "Clique sur un mot pour l'enregistrer dans ton carnet.",
    de: "Klick auf ein Wort, um es in deinem Notizbuch zu speichern.",
    it: "Clicca su una parola per salvarla nel tuo quaderno.",
    pt: "Clique em uma palavra para guardá-la no seu caderno.",
    ja: "ことばを クリックすると、ノートに ほぞんできます。",
  },
  {
    en: "The villagers remember you. Say hello every day!",
    es: "Los vecinos se acuerdan de ti. ¡Salúdalos cada día!",
    fr: "Les habitants se souviennent de toi. Dis bonjour chaque jour !",
    de: "Die Leute im Dorf erinnern sich an dich. Sag jeden Tag Hallo!",
    it: "Gli abitanti si ricordano di te. Saluta ogni giorno!",
    pt: "Os moradores se lembram de você. Diga oi todos os dias!",
    ja: "むらの 人たちは あなたを おぼえています。まいにち あいさつしましょう！",
  },
  {
    en: "Mistakes are fine. Everyone here is kind.",
    es: "Equivocarse está bien. Aquí todos son amables.",
    fr: "Les erreurs, ce n'est pas grave. Ici, tout le monde est gentil.",
    de: "Fehler sind okay. Hier sind alle freundlich.",
    it: "Sbagliare va bene. Qui sono tutti gentili.",
    pt: "Errar não tem problema. Aqui todo mundo é gentil.",
    ja: "まちがえても だいじょうぶ。ここの 人は みんな やさしいです。",
  },
  {
    en: "Review your notebook a little every day.",
    es: "Repasa tu cuaderno un poco cada día.",
    fr: "Révise ton carnet un peu chaque jour.",
    de: "Wiederhole jeden Tag ein bisschen aus deinem Notizbuch.",
    it: "Ripassa il tuo quaderno un po' ogni giorno.",
    pt: "Revise o seu caderno um pouco todos os dias.",
    ja: "まいにち すこしずつ ノートを ふくしゅうしましょう。",
  },
  {
    en: "Hover over a word to see what it means.",
    es: "Pasa el ratón sobre una palabra para ver qué significa.",
    fr: "Passe la souris sur un mot pour voir ce qu'il veut dire.",
    de: "Fahr mit der Maus über ein Wort, um zu sehen, was es bedeutet.",
    it: "Passa il mouse su una parola per vedere cosa significa.",
    pt: "Passe o mouse sobre uma palavra para ver o que ela significa.",
    ja: "ことばに マウスを のせると、いみが わかります。",
  },
  {
    en: "Sit on a bench and listen to the town.",
    es: "Siéntate en un banco y escucha el pueblo.",
    fr: "Assieds-toi sur un banc et écoute le village.",
    de: "Setz dich auf eine Bank und hör dem Dorf zu.",
    it: "Siediti su una panchina e ascolta il paese.",
    pt: "Sente-se em um banco e ouça a vila.",
    ja: "ベンチに すわって、まちの 音を きいてみましょう。",
  },
  {
    en: "Speak slowly. Short sentences are perfect.",
    es: "Habla despacio. Las frases cortas son perfectas.",
    fr: "Parle lentement. Les phrases courtes sont parfaites.",
    de: "Sprich langsam. Kurze Sätze sind perfekt.",
    it: "Parla piano. Le frasi brevi sono perfette.",
    pt: "Fale devagar. Frases curtas são perfeitas.",
    ja: "ゆっくり 話しましょう。みじかい 文で だいじょうぶです。",
  },
];

/** The tip language for a BCP 47 tag (`pt-BR` → pt), or null when there are no tips in it. */
export function tipLangFor(lang: string | null | undefined): TipLang | null {
  const primary = (lang ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return (TIP_LANGS as readonly string[]).includes(primary) ? (primary as TipLang) : null;
}

export interface ShownTip {
  /** The tip in the target language (null when there are no tips in it). */
  target: { lang: TipLang; text: string } | null;
  /** The same tip in the UI language, shown under it (or alone). */
  translation: { lang: TipLang; text: string } | null;
}

/**
 * The `index`-th tip (wrapping) in the target language, with its translation in the UI language
 * when that is a different language.
 */
export function tipFor(index: number, targetLang: string | null | undefined, uiLang: string): ShownTip {
  const tip = LOADING_TIPS[((index % LOADING_TIPS.length) + LOADING_TIPS.length) % LOADING_TIPS.length]!;
  const target = tipLangFor(targetLang);
  const ui = tipLangFor(uiLang) ?? "en";
  return {
    target: target ? { lang: target, text: tip[target] } : null,
    translation: target === ui ? null : { lang: ui, text: tip[ui] },
  };
}

/** Seconds a tip stays on screen. */
export const TIP_SECONDS = 7;
