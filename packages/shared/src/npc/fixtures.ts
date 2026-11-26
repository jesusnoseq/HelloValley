import { effectiveLevelInfo, type Level } from "../data/difficulty";
import { SHOPS } from "../data/items";
import type { NpcId } from "../data/npcs";
import { recipesTaughtBy } from "../data/recipes";
import type { NpcContextMessage } from "../protocol/messages";
import { npcSellUnitPrice } from "./actions";
import type { NpcTurnReplyInput } from "./reply";

/**
 * Test fixtures for NPC turns (build plan M21 acceptance: the Baker in Spanish at A1 and in
 * Japanese at B2, buying bread through an `offer`). Not exported from the package index.
 */

export function npcContextFixture(o: { npcId?: NpcId; lang: string; nativeLang?: string; playerLevel: Level; hearts?: number }): NpcContextMessage {
  const npcId = o.npcId ?? "baker";
  const eff = effectiveLevelInfo(o.playerLevel, npcId);
  return {
    conversationId: "conv-1",
    turnId: "turn-1",
    npcId,
    lang: o.lang,
    nativeLang: o.nativeLang ?? "en",
    playerLevel: o.playerLevel,
    effectiveLevel: eff.level,
    simplified: eff.simplified,
    hearts: o.hearts ?? 0,
    contact: { greeting: 0, decay: 0 },
    giftedToday: false,
    lastSeen: null,
    coins: 50,
    memory: null,
    learningWords: [],
    stock: (SHOPS[npcId]?.sells ?? []).map((itemId) => ({ itemId, price: npcSellUnitPrice(npcId, itemId) })),
    buys: [],
    inventory: [],
    recipes: recipesTaughtBy(npcId).map((r) => ({ recipeId: r.id, heartsRequired: r.heartsRequired, known: false })),
    quests: [],
    flags: [],
    news: [],
    world: { timeOfDay: "morning", weather: "sun", location: "bakery", minutes: 8 * 60 },
    turnsLeft: 30,
  };
}

/** The Baker at A1 Spanish (effective A1, simplified): "Yes, dear! Bread, 5 coins." with an offer. */
export const BAKER_ES_A1_REPLY: NpcTurnReplyInput = {
  lines: [
    {
      text: "¡Sí, cariño! Pan, cinco monedas.",
      translation: "Yes, dear! Bread, five coins.",
      emotion: "happy",
      tokens: [
        { surface: "¡", gloss: "", pos: "punct" },
        { surface: "Sí", lemma: "sí", gloss: "yes", pos: "interj" },
        { surface: ",", gloss: "", pos: "punct" },
        { surface: "cariño", lemma: "cariño", gloss: "dear", pos: "noun" },
        { surface: "!", gloss: "", pos: "punct" },
        { surface: "Pan", lemma: "pan", gloss: "bread", pos: "noun" },
        { surface: ",", gloss: "", pos: "punct" },
        { surface: "cinco", lemma: "cinco", gloss: "five", pos: "num" },
        { surface: "monedas", lemma: "moneda", gloss: "coins", pos: "noun" },
        { surface: ".", gloss: "", pos: "punct" },
      ],
    },
  ],
  suggestedReplies: [
    { text: "Sí, por favor.", translation: "Yes, please." },
    { text: "¿Cuánto cuesta?", translation: "How much is it?" },
    { text: "No, gracias.", translation: "No, thank you." },
  ],
  // The model's price is wrong on purpose: the server recomputes it (5 coins).
  actions: [{ type: "offer", itemId: "bread", qty: 1, price: 1 }],
};

/** The Baker at B2 Japanese (effective B1): a fuller line, a reading for every token, an offer. */
export const BAKER_JA_B2_REPLY: NpcTurnReplyInput = {
  lines: [
    {
      text: "焼きたてのパンがあるわよ。一つどう？",
      reading: "yakitate no pan ga aru wa yo. hitotsu dou?",
      translation: "I have freshly baked bread. How about one?",
      emotion: "happy",
      tokens: [
        { surface: "焼きたて", lemma: "焼きたて", reading: "やきたて", romanized: "yakitate", gloss: "freshly baked", pos: "noun" },
        { surface: "の", reading: "の", romanized: "no", gloss: "(of)", pos: "particle" },
        { surface: "パン", reading: "ぱん", romanized: "pan", gloss: "bread", pos: "noun" },
        { surface: "が", reading: "が", romanized: "ga", gloss: "(subject)", pos: "particle" },
        { surface: "ある", lemma: "ある", reading: "ある", romanized: "aru", gloss: "there is", pos: "verb" },
        { surface: "わよ", reading: "わよ", romanized: "wa yo", gloss: "(you know)", pos: "particle" },
        { surface: "。", gloss: "", pos: "punct" },
        { surface: "一つ", reading: "ひとつ", romanized: "hitotsu", gloss: "one", pos: "num" },
        { surface: "どう", reading: "どう", romanized: "dou", gloss: "how about", pos: "adv" },
        { surface: "？", gloss: "", pos: "punct" },
      ],
    },
  ],
  suggestedReplies: [],
  actions: [
    { type: "offer", itemId: "bread", qty: 1, price: 5 },
    { type: "friendshipDelta", delta: 1 },
  ],
};
