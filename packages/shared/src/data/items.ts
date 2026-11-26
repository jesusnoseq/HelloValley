import { z } from "zod";
import { FISH, type FishId } from "./fish";
import { FORAGE, LOST_ITEMS, forageIdsOfKind, type ForageId, type ForageKind, type LostItemId } from "./forage";
import type { NpcId } from "./npcs";

export const ITEM_CATEGORIES = [
  "food",
  "drink",
  "ingredient",
  "remedy",
  "seed",
  "tool",
  "furniture",
  "gift",
  "book",
  "fish",
  "forage",
  "lost",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** Categories the player can eat or drink from the hotbar (GDD §5.4). */
export const CONSUMABLE_CATEGORIES: readonly ItemCategory[] = ["food", "drink", "remedy"];

export const BUFF_KINDS = ["walk_speed", "reply_hint", "fishing_luck", "happy_emote", "cosmetic_glow"] as const;
export type BuffKind = (typeof BUFF_KINDS)[number];

/**
 * A timed effect from eating or drinking (GDD §5.4). `amount` is a fraction for walk_speed and
 * fishing_luck (0.1 = +10%), a count for reply_hint, and unused (0) for emotes and glows.
 * `durationSec` is in real seconds; 0 means instant. TODO(M29): apply and expire buffs.
 */
export interface Buff {
  kind: BuffKind;
  amount: number;
  durationSec: number;
}

export interface ItemDef {
  id: string;
  category: ItemCategory;
  /** Shop price in coins. Prices are deliberately round and small (GDD §5). */
  basePrice: number;
  /** False for quest objects such as lost items. */
  sellable: boolean;
  buff?: Buff;
}

const WALK_SPEED: Buff = { kind: "walk_speed", amount: 0.1, durationSec: 5 * 60 };
const REPLY_HINT: Buff = { kind: "reply_hint", amount: 1, durationSec: 10 * 60 };
const FISHING_LUCK: Buff = { kind: "fishing_luck", amount: 0.2, durationSec: 10 * 60 };
const HAPPY_EMOTE: Buff = { kind: "happy_emote", amount: 0, durationSec: 0 };
const GLOW: Buff = { kind: "cosmetic_glow", amount: 0, durationSec: 5 * 60 };

const item = (id: string, category: ItemCategory, basePrice: number, buff?: Buff): ItemDef =>
  buff ? { id, category, basePrice, sellable: true, buff } : { id, category, basePrice, sellable: true };

export const BASE_ITEM_IDS = [
  // Bakery
  "bread",
  "rye_bread",
  "croissant",
  "cinnamon_roll",
  "berry_tart",
  "cake",
  // Café
  "coffee",
  "tea",
  "hot_chocolate",
  "cookie",
  "sandwich",
  // Cooked at home
  "fish_stew",
  "omelette",
  "mushroom_soup",
  // Ingredients
  "flour",
  "sugar",
  "butter",
  "egg",
  "milk",
  "carrot",
  "potato",
  "tomato",
  "cabbage",
  "onion",
  // Clinic
  "herbal_tea",
  "cough_drops",
  "energy_tonic",
  // Farm seeds (cosmetic plants)
  "flower_seeds",
  "herb_seeds",
  // General store
  "fishing_rod",
  "bug_net",
  "wooden_chair",
  "small_table",
  "floor_lamp",
  "round_rug",
  "potted_plant",
  "bookshelf",
  "flower_bouquet",
  "gift_box",
  "scented_candle",
  // Library
  "village_history",
  "fish_guide",
  "romance_novel",
] as const;
type BaseItemId = (typeof BASE_ITEM_IDS)[number];

const BASE_ITEMS: Record<BaseItemId, ItemDef> = {
  bread: item("bread", "food", 5, WALK_SPEED),
  rye_bread: item("rye_bread", "food", 6, WALK_SPEED),
  croissant: item("croissant", "food", 4),
  cinnamon_roll: item("cinnamon_roll", "food", 5),
  berry_tart: item("berry_tart", "food", 12, HAPPY_EMOTE),
  cake: item("cake", "food", 15, HAPPY_EMOTE),
  coffee: item("coffee", "drink", 4, REPLY_HINT),
  tea: item("tea", "drink", 3),
  hot_chocolate: item("hot_chocolate", "drink", 5, HAPPY_EMOTE),
  cookie: item("cookie", "food", 2),
  sandwich: item("sandwich", "food", 6),
  fish_stew: item("fish_stew", "food", 20, FISHING_LUCK),
  omelette: item("omelette", "food", 10),
  mushroom_soup: item("mushroom_soup", "food", 12),
  flour: item("flour", "ingredient", 2),
  sugar: item("sugar", "ingredient", 2),
  butter: item("butter", "ingredient", 3),
  egg: item("egg", "ingredient", 2),
  milk: item("milk", "ingredient", 3),
  carrot: item("carrot", "ingredient", 2),
  potato: item("potato", "ingredient", 2),
  tomato: item("tomato", "ingredient", 2),
  cabbage: item("cabbage", "ingredient", 3),
  onion: item("onion", "ingredient", 2),
  herbal_tea: item("herbal_tea", "remedy", 6, GLOW),
  cough_drops: item("cough_drops", "remedy", 3),
  energy_tonic: item("energy_tonic", "remedy", 10, GLOW),
  flower_seeds: item("flower_seeds", "seed", 5),
  herb_seeds: item("herb_seeds", "seed", 5),
  fishing_rod: item("fishing_rod", "tool", 50),
  bug_net: item("bug_net", "tool", 30),
  wooden_chair: item("wooden_chair", "furniture", 20),
  small_table: item("small_table", "furniture", 30),
  floor_lamp: item("floor_lamp", "furniture", 25),
  round_rug: item("round_rug", "furniture", 20),
  potted_plant: item("potted_plant", "furniture", 15),
  bookshelf: item("bookshelf", "furniture", 40),
  flower_bouquet: item("flower_bouquet", "gift", 10),
  gift_box: item("gift_box", "gift", 15),
  scented_candle: item("scented_candle", "gift", 10),
  village_history: item("village_history", "book", 15),
  fish_guide: item("fish_guide", "book", 15),
  romance_novel: item("romance_novel", "book", 10),
};

export type ItemId = BaseItemId | FishId | ForageId | LostItemId;

/** Every item that can sit in an inventory slot (GDD §5.6): base items, fish, forage and lost items. */
export const ITEMS: Readonly<Record<ItemId, ItemDef>> = {
  ...BASE_ITEMS,
  ...(Object.fromEntries(FISH.map((f) => [f.id, item(f.id, "fish", f.basePrice)])) as Record<FishId, ItemDef>),
  ...(Object.fromEntries(FORAGE.map((f) => [f.id, item(f.id, "forage", f.basePrice)])) as Record<ForageId, ItemDef>),
  ...(Object.fromEntries(
    LOST_ITEMS.map((l) => [l.id, { id: l.id, category: "lost", basePrice: 0, sellable: false } satisfies ItemDef]),
  ) as Record<LostItemId, ItemDef>),
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const ItemIdSchema = z.enum(ITEM_IDS as [ItemId, ...ItemId[]]);

export function isItemId(value: unknown): value is ItemId {
  return typeof value === "string" && Object.hasOwn(ITEMS, value);
}

export function getItem(id: string): ItemDef | undefined {
  return isItemId(id) ? ITEMS[id] : undefined;
}

/** i18n key for the item's world/inventory label, generated per language (GDD §6.5). */
export function itemLabelKey(id: ItemId): string {
  return `item.${id}`;
}

export function isConsumable(id: ItemId): boolean {
  return CONSUMABLE_CATEGORIES.includes(ITEMS[id].category);
}

export interface ShopDef {
  sells: readonly ItemId[];
  /** Items this NPC buys from the player, or "any" for the Shopkeeper's lowball offers. */
  buys: readonly ItemId[] | "any";
}

const PLANTS_AND_MUSHROOMS: ForageKind[] = ["flower", "mushroom", "berry", "herb"];

/**
 * Buy and sell lists per NPC (GDD §5.1). The server checks `offer`/`buy` proposals against these
 * and recomputes prices from `ITEMS` (architecture §6.1); the price rules (the Shopkeeper's
 * inflated opening, haggling, buy-back rates) are npc/actions.ts. Trades settle in one Admin SDK
 * transaction after the player confirms them (build plans M21, M26).
 * The GDD's "clothing colours" at the general store are not sold: the mirror (M15) already lets
 * every player pick any colour for free, so there is nothing to unlock (decision in pending.md).
 * Fish have no specialist buyer yet (only the Shopkeeper's lowball). TODO(M27): who buys fish.
 */
export const SHOPS: Partial<Record<NpcId, ShopDef>> = {
  baker: {
    sells: ["bread", "rye_bread", "croissant", "cinnamon_roll", "berry_tart", "cake"],
    buys: ["flour", "egg", "wild_berries"],
  },
  farmer: {
    sells: ["carrot", "potato", "tomato", "cabbage", "onion", "egg", "milk", "flower_seeds", "herb_seeds"],
    buys: forageIdsOfKind(...PLANTS_AND_MUSHROOMS),
  },
  shopkeeper: {
    sells: [
      "flour",
      "sugar",
      "butter",
      "fishing_rod",
      "bug_net",
      "wooden_chair",
      "small_table",
      "floor_lamp",
      "round_rug",
      "potted_plant",
      "bookshelf",
      "flower_bouquet",
      "gift_box",
      "scented_candle",
    ],
    buys: "any",
  },
  barista: {
    sells: ["coffee", "tea", "hot_chocolate", "cookie", "sandwich"],
    buys: [],
  },
  doctor: {
    sells: ["herbal_tea", "cough_drops", "energy_tonic"],
    buys: forageIdsOfKind("herb"),
  },
  librarian: {
    sells: ["village_history", "fish_guide", "romance_novel"],
    buys: forageIdsOfKind("rare_find"),
  },
};

/**
 * What each villager may hand the player as a gift (the model's `give`, architecture §6.1: only from
 * this table, at most one per NPC per in-game day). Small, cheap things in character, so a forged
 * `give` gets no more than a friendly chat would (build plan M26, my lists). The residents, who
 * sell nothing, give too.
 */
export const NPC_GIFTS: Readonly<Record<NpcId, readonly ItemId[]>> = {
  shopkeeper: ["flour", "sugar"],
  baker: ["bread", "croissant", "cinnamon_roll"],
  barista: ["coffee", "tea", "cookie"],
  farmer: ["carrot", "potato", "egg", "flower_seeds"],
  mayor: ["cookie", "flower_seeds"],
  librarian: ["tea"],
  doctor: ["cough_drops", "herbal_tea"],
  gossip: ["cookie", "croissant"],
  elder: ["tea", "herb_seeds"],
};

export function npcSells(npcId: NpcId, itemId: ItemId): boolean {
  return SHOPS[npcId]?.sells.includes(itemId) ?? false;
}

export function npcBuys(npcId: NpcId, itemId: ItemId): boolean {
  const buys = SHOPS[npcId]?.buys;
  if (buys === undefined || !ITEMS[itemId].sellable) return false;
  return buys === "any" || buys.includes(itemId);
}
