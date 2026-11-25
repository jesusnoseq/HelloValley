import { SHOPS } from "../data/items";
import type { Level } from "../data/difficulty";
import type { NpcId } from "../data/npcs";
import { requestedSuggestions } from "./levels";
import type { SuggestedReply } from "./reply";

/**
 * Suggested replies before the NPC's first model turn (build plan M23). The opener comes from the
 * cache (GDD §8.1 step 2) and carries no suggestions, so the panel starts with these: a greeting,
 * a question that fits the NPC (what a shop has, or how they are) and a goodbye. Written for the
 * featured languages, like the canned lines; other languages start with free input only.
 */

type StarterKind = "hello" | "shop" | "chat" | "bye";

interface StarterSource {
  text: string;
  reading?: string;
}

const STARTERS: Readonly<Record<string, Record<StarterKind, StarterSource>>> = {
  en: { hello: { text: "Hello!" }, shop: { text: "What do you have today?" }, chat: { text: "How are you?" }, bye: { text: "Goodbye!" } },
  es: { hello: { text: "¡Hola!" }, shop: { text: "¿Qué tienes hoy?" }, chat: { text: "¿Cómo estás?" }, bye: { text: "¡Adiós!" } },
  fr: { hello: { text: "Bonjour !" }, shop: { text: "Qu'est-ce que vous avez aujourd'hui ?" }, chat: { text: "Comment ça va ?" }, bye: { text: "Au revoir !" } },
  de: { hello: { text: "Hallo!" }, shop: { text: "Was haben Sie heute?" }, chat: { text: "Wie geht's?" }, bye: { text: "Tschüss!" } },
  it: { hello: { text: "Ciao!" }, shop: { text: "Cosa avete oggi?" }, chat: { text: "Come stai?" }, bye: { text: "Arrivederci!" } },
  pt: { hello: { text: "Olá!" }, shop: { text: "O que você tem hoje?" }, chat: { text: "Como vai?" }, bye: { text: "Tchau!" } },
  ja: {
    hello: { text: "こんにちは！", reading: "konnichiwa!" },
    shop: { text: "今日は何がありますか？", reading: "kyou wa nani ga arimasu ka?" },
    chat: { text: "お元気ですか？", reading: "ogenki desu ka?" },
    bye: { text: "さようなら！", reading: "sayounara!" },
  },
};

/** Translations in the UI languages the client has (others fall back to English). */
const TRANSLATIONS: Readonly<Record<string, Record<StarterKind, string>>> = {
  en: { hello: "Hello!", shop: "What do you have today?", chat: "How are you?", bye: "Goodbye!" },
  es: { hello: "¡Hola!", shop: "¿Qué tienes hoy?", chat: "¿Cómo estás?", bye: "¡Adiós!" },
};

const base = (lang: string) => lang.split("-")[0]!.toLowerCase();

/**
 * The starter replies for a conversation with `npcId`, as many as the model would be asked for at
 * `level` (`requestedSuggestions`: at C1+ one, which the panel hides behind the 💡). Empty for a
 * language without starters.
 */
export function starterSuggestions(npcId: NpcId, targetLang: string, nativeLang: string, level: Level): SuggestedReply[] {
  const source = STARTERS[base(targetLang)];
  if (!source) return [];
  const translations = TRANSLATIONS[base(nativeLang)] ?? TRANSLATIONS.en!;
  const same = base(targetLang) === base(nativeLang);
  const kinds: StarterKind[] = ["hello", SHOPS[npcId]?.sells.length ? "shop" : "chat", "bye"];
  // B1 drops the goodbye; B2 and above keep only the greeting (a starter fragment, or the 💡).
  return kinds.slice(0, requestedSuggestions(level)).map((kind) => {
    const s = source[kind];
    return { text: s.text, ...(s.reading ? { reading: s.reading } : {}), translation: same ? "" : translations[kind] };
  });
}
