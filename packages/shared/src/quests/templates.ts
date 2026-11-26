import { type FishId, getFish } from "../data/fish";
import { type ForageKind, getForage } from "../data/forage";
import { getItem, type ItemId } from "../data/items";
import { getNpc, type NpcId } from "../data/npcs";
import { getRecipe, type RecipeId } from "../data/recipes";
import { QUEST_COMPLETION_HEARTS } from "../npc/friendship";

/**
 * Daily requests and quests (GDD §5.5, build plan M30). A *template* is one concrete request from
 * the catalog below ("The Farmer needs 3 eggs delivered to the Bakery before 12:00"); the Town Hall
 * board shows three of them per player per in-game day, and a few villagers ask for one more in
 * conversation (`giveQuest`). Because the catalog is finite, the notice text can be generated once
 * per template × target language × level band by the admin seeding tool (architecture §6.3),
 * with per-player generation on a cache miss (quests/notice.ts).
 *
 * Five kinds (my semantics; the GDD names none):
 *
 * | Kind | What the player does | How it completes |
 * |---|---|---|
 * | `deliver` | brings `qty` × item to the recipient NPC before the deadline | handed over in a conversation with the recipient |
 * | `fetch` | brings `qty` × a found item to the requester (by the end of the day) | handed over in a conversation with the requester |
 * | `catch` | catches `qty` fish (one species, or any) after accepting | automatically, on the server's catch |
 * | `cook` | cooks `qty` × a dish at home after accepting | automatically, on the server's `cook:make` |
 * | `find` | picks up `qty` forage items of a kind after accepting | automatically, on the server's pick-up |
 *
 * Hand-in quests complete through the model's `completeQuest` (only when the server's conditions
 * hold, architecture §6.1) or the "Hand over" card; both take the items in the same transaction
 * that pays the reward. Rewards are coins, hearts with the requester and sometimes furniture.
 */

export const QUEST_KINDS = ["deliver", "fetch", "catch", "cook", "find"] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];

/** Kinds handed over to an NPC (the rest complete on their own server event). */
export const HAND_IN_KINDS: readonly QuestKind[] = ["deliver", "fetch"];

export type QuestTarget =
  | { kind: "deliver"; itemId: ItemId; qty: number; to: NpcId; /** In-game clock time `HH:MM` the delivery must arrive by. */ by: string }
  | { kind: "fetch"; itemId: ItemId; qty: number }
  | { kind: "catch"; /** Omitted: any fish. */ fishId?: FishId; qty: number }
  | { kind: "cook"; recipeId: RecipeId; qty: number }
  | { kind: "find"; forageKind: ForageKind; qty: number };

export interface QuestReward {
  coins: number;
  /** Hearts with the requester (`giver`). */
  hearts: number;
  /** A bonus item (furniture on some board days). */
  itemId?: ItemId;
}

export interface QuestTemplate {
  /** Stable id (also part of the notice cache key, so never reuse one for a different request). */
  id: string;
  /** Who asks (gets the hearts; hands the request to the Mayor for the board). */
  giver: NpcId;
  target: QuestTarget;
}

/** The request catalog (my choices; every item, fish, recipe and NPC exists in the game data). */
export const QUEST_TEMPLATES = [
  // deliver: bought (or grown) goods carried from one villager to another, before a deadline.
  { id: "eggs_to_bakery", giver: "farmer", target: { kind: "deliver", itemId: "egg", qty: 3, to: "baker", by: "12:00" } },
  { id: "flour_to_bakery", giver: "shopkeeper", target: { kind: "deliver", itemId: "flour", qty: 2, to: "baker", by: "14:00" } },
  { id: "milk_to_cafe", giver: "farmer", target: { kind: "deliver", itemId: "milk", qty: 2, to: "barista", by: "15:00" } },
  { id: "tea_to_elder", giver: "barista", target: { kind: "deliver", itemId: "tea", qty: 1, to: "elder", by: "18:00" } },
  { id: "croissants_to_library", giver: "baker", target: { kind: "deliver", itemId: "croissant", qty: 2, to: "librarian", by: "13:00" } },
  { id: "drops_to_gossip", giver: "doctor", target: { kind: "deliver", itemId: "cough_drops", qty: 1, to: "gossip", by: "17:00" } },
  { id: "cookies_to_mayor", giver: "barista", target: { kind: "deliver", itemId: "cookie", qty: 3, to: "mayor", by: "16:00" } },
  // fetch: found things brought to whoever asked.
  { id: "herbs_for_doctor", giver: "doctor", target: { kind: "fetch", itemId: "wild_herb", qty: 2 } },
  { id: "berries_for_baker", giver: "baker", target: { kind: "fetch", itemId: "wild_berries", qty: 3 } },
  { id: "daisies_for_mayor", giver: "mayor", target: { kind: "fetch", itemId: "daisy", qty: 3 } },
  { id: "mushrooms_for_elder", giver: "elder", target: { kind: "fetch", itemId: "button_mushroom", qty: 2 } },
  { id: "shell_for_gossip", giver: "gossip", target: { kind: "fetch", itemId: "river_shell", qty: 2 } },
  { id: "mint_for_barista", giver: "barista", target: { kind: "fetch", itemId: "mint", qty: 2 } },
  { id: "pebbles_for_librarian", giver: "librarian", target: { kind: "fetch", itemId: "smooth_pebble", qty: 2 } },
  // catch: the server's catch counts (the fish stays in the bag).
  { id: "two_fish_for_elder", giver: "elder", target: { kind: "catch", qty: 2 } },
  { id: "carp_for_farmer", giver: "farmer", target: { kind: "catch", fishId: "carp", qty: 1 } },
  { id: "minnows_for_mayor", giver: "mayor", target: { kind: "catch", fishId: "minnow", qty: 2 } },
  { id: "fish_for_shopkeeper", giver: "shopkeeper", target: { kind: "catch", qty: 3 } },
  // cook: only recipes their teachers teach at 0 hearts, so any player can learn them the same day.
  { id: "bake_bread", giver: "baker", target: { kind: "cook", recipeId: "bread", qty: 1 } },
  { id: "cook_omelette", giver: "farmer", target: { kind: "cook", recipeId: "omelette", qty: 1 } },
  // find: forage pick-ups of a kind (the find stays in the bag).
  { id: "find_flowers", giver: "mayor", target: { kind: "find", forageKind: "flower", qty: 2 } },
  { id: "find_shells", giver: "gossip", target: { kind: "find", forageKind: "shell", qty: 2 } },
  { id: "find_mushroom", giver: "elder", target: { kind: "find", forageKind: "mushroom", qty: 1 } },
  { id: "find_herbs", giver: "doctor", target: { kind: "find", forageKind: "herb", qty: 2 } },
  { id: "find_pebbles", giver: "librarian", target: { kind: "find", forageKind: "pebble", qty: 2 } },
] as const satisfies readonly QuestTemplate[];

export type QuestTemplateId = (typeof QUEST_TEMPLATES)[number]["id"];
export const QUEST_TEMPLATE_IDS = QUEST_TEMPLATES.map((t) => t.id) as readonly QuestTemplateId[];

export function getQuestTemplate(id: string): QuestTemplate | undefined {
  return (QUEST_TEMPLATES as readonly QuestTemplate[]).find((t) => t.id === id);
}

export function templatesOfKind(kind: QuestKind): QuestTemplate[] {
  return (QUEST_TEMPLATES as readonly QuestTemplate[]).filter((t) => t.target.kind === kind);
}

export const isHandIn = (t: Pick<QuestTemplate, "target">) => HAND_IN_KINDS.includes(t.target.kind);

/** Who the request is handed to: the recipient of a delivery, the requester of a fetch; null for automatic kinds. */
export function turnInNpc(t: Pick<QuestTemplate, "giver" | "target">): NpcId | null {
  if (t.target.kind === "deliver") return t.target.to;
  if (t.target.kind === "fetch") return t.giver;
  return null;
}

/** The NPCs a quest involves (the requester and, for a delivery, the recipient). */
export function questNpcs(t: Pick<QuestTemplate, "giver" | "target">): NpcId[] {
  return t.target.kind === "deliver" && t.target.to !== t.giver ? [t.giver, t.target.to] : [t.giver];
}

/** How many of something the request needs. */
export const questQty = (t: Pick<QuestTemplate, "target">) => t.target.qty;

// ---------------------------------------------------------------------------------------------
// Rewards (my numbers): always a little more than the items are worth, so a request is worth doing.

/** Coins on top of the items' value. */
export const QUEST_BASE_COINS: Readonly<Record<QuestKind, number>> = { deliver: 8, fetch: 6, catch: 10, cook: 12, find: 6 };
/** What "any fish" counts as when valuing a catch request. */
const ANY_FISH_VALUE = 3;

function unitValue(target: QuestTarget): number {
  switch (target.kind) {
    case "deliver":
    case "fetch":
      return getItem(target.itemId)?.basePrice ?? 0;
    case "catch":
      return target.fishId ? (getFish(target.fishId)?.basePrice ?? ANY_FISH_VALUE) : ANY_FISH_VALUE;
    case "cook":
      return 0;
    case "find":
      return 2;
  }
}

/** The coins and hearts a template pays (the board may add a bonus item, quests/board.ts). */
export function baseQuestReward(t: Pick<QuestTemplate, "target">): QuestReward {
  return { coins: QUEST_BASE_COINS[t.target.kind] + unitValue(t.target) * t.target.qty, hearts: QUEST_COMPLETION_HEARTS };
}

// ---------------------------------------------------------------------------------------------
// Plain English facts (the prompt's `quest_json` and the NPC context; never shown to the player)

const npcName = (id: NpcId) => getNpc(id).englishName.replace(/^the /i, "");
const itemWord = (id: ItemId) => getFish(id)?.englishName ?? getForage(id)?.englishName ?? id.replace(/_/g, " ");

/** The details the notice must contain (npc-runtime.md §9.3: who, what, quantity, where, deadline). */
export interface QuestFacts {
  kind: QuestKind;
  who: string;
  what: string;
  quantity: number;
  where?: string;
  deadline?: string;
}

export function questFacts(t: QuestTemplate): QuestFacts {
  const who = npcName(t.giver);
  const target = t.target;
  switch (target.kind) {
    case "deliver":
      return { kind: target.kind, who, what: itemWord(target.itemId), quantity: target.qty, where: `deliver to the ${npcName(target.to)}`, deadline: `before ${target.by}` };
    case "fetch":
      return { kind: target.kind, who, what: itemWord(target.itemId), quantity: target.qty, where: `bring to the ${who}`, deadline: "today" };
    case "catch":
      return { kind: target.kind, who, what: target.fishId ? `${itemWord(target.fishId)} (catch at the river)` : "any fish (catch at the river)", quantity: target.qty, deadline: "today" };
    case "cook":
      return { kind: target.kind, who, what: `${getRecipe(target.recipeId)?.id.replace(/_/g, " ") ?? target.recipeId} (cook it at home)`, quantity: target.qty, deadline: "today" };
    case "find":
      return { kind: target.kind, who, what: `${target.forageKind.replace(/_/g, " ")}s (find them around the village)`, quantity: target.qty, deadline: "today" };
  }
}

/** One English sentence for the NPC's context (`quests_json`). */
export function questSummaryEn(t: QuestTemplate): string {
  const f = questFacts(t);
  const parts = [`${f.who} wants ${f.quantity} × ${f.what}`, f.where, f.deadline].filter(Boolean);
  return parts.join(", ");
}
