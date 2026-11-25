import type { TokenInput } from "../language/tokens";
import { type NpcLine, NpcLineSchema } from "./reply";

/**
 * Canned fallback lines (build plan M21, architecture §5.2 "Canned lines + the NPC is busy, come
 * back later"), used when the model fails twice in a row or the turn limits are reached. They are
 * written for the featured languages; for any other language the client shows its own UI message
 * (in the player's native language) instead, since a line in the wrong language would teach the
 * wrong thing. Token glosses are left empty: the bubble shows the whole-line translation.
 */

export type CannedKind =
  /** The answer could not be used: ask the player to say it again (the turn id stays valid). */
  | "retry"
  /** The NPC cannot talk now (repeated failures, limits): come back later. */
  | "busy";

interface CannedSource {
  text: string;
  /** Japanese: the tokens with their kana readings, and the romaji line. */
  tokens?: TokenInput[];
  reading?: string;
}

const CANNED: Readonly<Record<string, Record<CannedKind, CannedSource>>> = {
  en: {
    retry: { text: "Sorry, I didn't catch that. Can you say it again?" },
    busy: { text: "Sorry, I'm busy right now. Come back later!" },
  },
  es: {
    retry: { text: "Perdón, no te entendí bien. ¿Puedes repetirlo?" },
    busy: { text: "Lo siento, ahora tengo mucho trabajo. ¡Vuelve más tarde!" },
  },
  fr: {
    retry: { text: "Pardon, je n'ai pas bien compris. Tu peux répéter ?" },
    busy: { text: "Pardon, j'ai beaucoup de travail maintenant. Reviens plus tard !" },
  },
  de: {
    retry: { text: "Entschuldigung, das habe ich nicht verstanden. Kannst du das wiederholen?" },
    busy: { text: "Tut mir leid, ich habe gerade viel zu tun. Komm später wieder!" },
  },
  it: {
    retry: { text: "Scusa, non ho capito bene. Puoi ripetere?" },
    busy: { text: "Scusa, adesso ho molto da fare. Torna più tardi!" },
  },
  pt: {
    retry: { text: "Desculpa, não entendi bem. Pode repetir?" },
    busy: { text: "Desculpa, agora tenho muito trabalho. Volte mais tarde!" },
  },
  ja: {
    retry: {
      text: "ごめんね、よく聞こえなかった。もう一度言って？",
      reading: "gomen ne, yoku kikoenakatta. mou ichido itte?",
      tokens: [
        { surface: "ごめんね", romanized: "gomen ne", gloss: "", pos: "interj" },
        { surface: "、", gloss: "", pos: "punct" },
        { surface: "よく", romanized: "yoku", gloss: "", pos: "adv" },
        { surface: "聞こえなかった", reading: "きこえなかった", romanized: "kikoenakatta", gloss: "", pos: "verb" },
        { surface: "。", gloss: "", pos: "punct" },
        { surface: "もう一度", reading: "もういちど", romanized: "mou ichido", gloss: "", pos: "adv" },
        { surface: "言って", reading: "いって", romanized: "itte", gloss: "", pos: "verb" },
        { surface: "？", gloss: "", pos: "punct" },
      ],
    },
    busy: {
      text: "ごめんね、今ちょっと忙しいの。また後で来てね。",
      reading: "gomen ne, ima chotto isogashii no. mata ato de kite ne.",
      tokens: [
        { surface: "ごめんね", romanized: "gomen ne", gloss: "", pos: "interj" },
        { surface: "、", gloss: "", pos: "punct" },
        { surface: "今", reading: "いま", romanized: "ima", gloss: "", pos: "noun" },
        { surface: "ちょっと", romanized: "chotto", gloss: "", pos: "adv" },
        { surface: "忙しい", reading: "いそがしい", romanized: "isogashii", gloss: "", pos: "adj" },
        { surface: "の", romanized: "no", gloss: "", pos: "particle" },
        { surface: "。", gloss: "", pos: "punct" },
        { surface: "また", romanized: "mata", gloss: "", pos: "adv" },
        { surface: "後で", reading: "あとで", romanized: "ato de", gloss: "", pos: "adv" },
        { surface: "来て", reading: "きて", romanized: "kite", gloss: "", pos: "verb" },
        { surface: "ね", romanized: "ne", gloss: "", pos: "particle" },
        { surface: "。", gloss: "", pos: "punct" },
      ],
    },
  },
};

/** The translations, in the UI languages the client has (others fall back to English). */
const TRANSLATIONS: Readonly<Record<string, Record<CannedKind, string>>> = {
  en: { retry: CANNED.en!.retry.text, busy: CANNED.en!.busy.text },
  es: { retry: CANNED.es!.retry.text, busy: CANNED.es!.busy.text },
};

export const CANNED_LANGUAGES = Object.keys(CANNED);

/** Latin-script lines: words and punctuation runs as tokens. */
function latinTokens(text: string): TokenInput[] {
  return (text.match(/[\p{L}\p{M}\p{N}'’-]+|[^\s\p{L}\p{M}\p{N}]+/gu) ?? []).map((surface) =>
    /[\p{L}\p{N}]/u.test(surface) ? { surface, gloss: "" } : { surface, gloss: "", pos: "punct" as const },
  );
}

/** A canned line in the target language, or null when there is none for it. */
export function cannedLine(kind: CannedKind, targetLang: string, nativeLang: string): NpcLine | null {
  const base = targetLang.split("-")[0]!.toLowerCase();
  const source = CANNED[base]?.[kind];
  if (!source) return null;
  const translation = (TRANSLATIONS[nativeLang.split("-")[0]!.toLowerCase()] ?? TRANSLATIONS.en!)[kind];
  return NpcLineSchema.parse({
    text: source.text,
    ...(source.reading ? { reading: source.reading } : {}),
    translation: base === nativeLang.split("-")[0] ? "" : translation,
    emotion: kind === "busy" ? "tired" : "neutral",
    tokens: source.tokens ?? latinTokens(source.text),
  });
}
