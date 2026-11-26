import type { ItemId } from "../data/items";
import { NPC_IDS, type NpcId } from "../data/npcs";
import { createRng, seedFrom } from "../fishing/rng";
import { baseQuestReward, getQuestTemplate, QUEST_KINDS, QUEST_TEMPLATES, type QuestKind, type QuestReward, type QuestTemplate } from "./templates";

/**
 * Which requests a player gets on an in-game day (build plan M30, GDD §5.5, architecture §3.1):
 * the Town Hall board's three, and the favours a couple of villagers ask in conversation. Both are
 * pure functions of (uid, target language, day), so the server recomputes the same set after a
 * restart and only the player's quest log (what they accepted and how far they got) is stored.
 * Coins and hearts are per target language (GDD §9.4), so each language has its own board.
 */

/** Requests on the Town Hall board per player per in-game day (GDD §5.5). */
export const BOARD_SIZE = 3;
/** Villagers who ask for a favour in conversation per player per day (my number). */
export const NPC_OFFERS_PER_DAY = 2;
/** Chance that a board request also pays a piece of furniture (GDD: "sometimes furniture"; my number). */
export const FURNITURE_BONUS_CHANCE = 0.25;
/** Cheap furniture the board hands out as a bonus (shop furniture, so it lands in the bag, build plan M26). */
export const QUEST_FURNITURE_BONUS: readonly ItemId[] = ["potted_plant", "round_rug", "wooden_chair", "floor_lamp"];
/** The Mayor posts the board (npc-runtime.md persona: "You hand out the Town Hall board requests"). */
export const BOARD_NPC: NpcId = "mayor";

export type QuestSource = "board" | "npc";

/** One request for one player on one day. */
export interface Quest {
  /** `q{day}-{templateId}`: unique per player and day (the same template never appears twice a day). */
  questId: string;
  day: number;
  source: QuestSource;
  template: QuestTemplate;
  reward: QuestReward;
}

const QUEST_ID = /^q(\d{1,9})-([a-z0-9_]{1,48})$/;

export function questIdFor(day: number, templateId: string): string {
  return `q${day}-${templateId}`;
}

/** The day and template of a quest id, or null when it is not one. */
export function parseQuestId(questId: string): { day: number; templateId: string } | null {
  const m = QUEST_ID.exec(questId);
  if (!m || !getQuestTemplate(m[2]!)) return null;
  return { day: Number(m[1]), templateId: m[2]! };
}

function quest(day: number, source: QuestSource, template: QuestTemplate, bonus?: ItemId): Quest {
  const reward = baseQuestReward(template);
  return { questId: questIdFor(day, template.id), day, source, template, reward: bonus ? { ...reward, itemId: bonus } : reward };
}

/**
 * The Town Hall board of one player on one day: BOARD_SIZE requests of different kinds (so the
 * board always mixes errands), each from the catalog. Deterministic.
 */
export function dailyBoard(uid: string, lang: string, day: number): Quest[] {
  const rng = createRng(seedFrom("quest-board", uid, lang, day));
  const kinds: QuestKind[] = [...QUEST_KINDS];
  const out: Quest[] = [];
  for (let i = 0; i < BOARD_SIZE && kinds.length > 0; i++) {
    const [kind] = kinds.splice(Math.floor(rng() * kinds.length), 1);
    const options = (QUEST_TEMPLATES as readonly QuestTemplate[]).filter((t) => t.target.kind === kind);
    const template = options[Math.floor(rng() * options.length)]!;
    const bonus = rng() < FURNITURE_BONUS_CHANCE ? QUEST_FURNITURE_BONUS[Math.floor(rng() * QUEST_FURNITURE_BONUS.length)] : undefined;
    out.push(quest(day, "board", template, bonus));
  }
  return out;
}

/**
 * The favours villagers ask this player for today (`giveQuest`): NPC_OFFERS_PER_DAY villagers
 * (never the Mayor, who posts the board), each with one of their own requests that is not on
 * today's board. Deterministic.
 */
export function npcOffers(uid: string, lang: string, day: number): Quest[] {
  const rng = createRng(seedFrom("quest-offers", uid, lang, day));
  const onBoard = new Set(dailyBoard(uid, lang, day).map((q) => q.template.id));
  const candidates = NPC_IDS.filter((id) => id !== BOARD_NPC);
  const out: Quest[] = [];
  while (out.length < NPC_OFFERS_PER_DAY && candidates.length > 0) {
    const [npcId] = candidates.splice(Math.floor(rng() * candidates.length), 1);
    const own = (QUEST_TEMPLATES as readonly QuestTemplate[]).filter((t) => t.giver === npcId && !onBoard.has(t.id));
    if (own.length === 0) continue;
    out.push(quest(day, "npc", own[Math.floor(rng() * own.length)]!));
  }
  return out;
}

/** Every request a player can take on a day: the board, then the villagers' favours. */
export function questsOfDay(uid: string, lang: string, day: number): Quest[] {
  return [...dailyBoard(uid, lang, day), ...npcOffers(uid, lang, day)];
}

/** The quest behind an id for this player, only if it is one of theirs on that day. */
export function questById(uid: string, lang: string, questId: string): Quest | null {
  const parsed = parseQuestId(questId);
  if (!parsed) return null;
  return questsOfDay(uid, lang, parsed.day).find((q) => q.questId === questId) ?? null;
}

/** The favour `npcId` asks this player for today, if any. */
export function npcOfferBy(uid: string, lang: string, day: number, npcId: NpcId): Quest | null {
  return npcOffers(uid, lang, day).find((q) => q.template.giver === npcId) ?? null;
}
