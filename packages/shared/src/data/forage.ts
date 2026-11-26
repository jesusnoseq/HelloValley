import type { NpcId } from "./npcs";
import { RARITY_WEIGHTS, type Rarity, type WeightedEntry } from "./rarity";
import type { PlaceId } from "./world";

export const FORAGE_KINDS = ["flower", "mushroom", "shell", "pebble", "berry", "herb", "rare_find"] as const;
export type ForageKind = (typeof FORAGE_KINDS)[number];

/** Spawn zones for daily forage (GDD §5.3). Their areas are `FORAGE_ZONE_AREAS` in world/town.ts. */
export const FORAGE_ZONES = ["meadow", "forest_edge", "riverbank", "hill", "square"] as const;
export type ForageZone = (typeof FORAGE_ZONES)[number];

export interface ForageDef {
  id: string;
  englishName: string;
  kind: ForageKind;
  rarity: Rarity;
  /** Sell price in coins. */
  basePrice: number;
  zones: readonly ForageZone[];
}

export const FORAGE = [
  { id: "daisy", englishName: "Daisy", kind: "flower", rarity: "common", basePrice: 2, zones: ["meadow", "square"] },
  { id: "poppy", englishName: "Poppy", kind: "flower", rarity: "common", basePrice: 3, zones: ["meadow"] },
  { id: "bluebell", englishName: "Bluebell", kind: "flower", rarity: "uncommon", basePrice: 5, zones: ["hill", "forest_edge"] },
  { id: "button_mushroom", englishName: "Button mushroom", kind: "mushroom", rarity: "common", basePrice: 3, zones: ["forest_edge", "meadow"] },
  { id: "chanterelle", englishName: "Chanterelle", kind: "mushroom", rarity: "uncommon", basePrice: 8, zones: ["forest_edge", "hill"] },
  { id: "river_shell", englishName: "River shell", kind: "shell", rarity: "common", basePrice: 2, zones: ["riverbank"] },
  { id: "spiral_shell", englishName: "Spiral shell", kind: "shell", rarity: "uncommon", basePrice: 6, zones: ["riverbank"] },
  { id: "smooth_pebble", englishName: "Smooth pebble", kind: "pebble", rarity: "common", basePrice: 1, zones: ["riverbank"] },
  { id: "crystal_pebble", englishName: "Crystal pebble", kind: "pebble", rarity: "rare", basePrice: 20, zones: ["riverbank", "hill"] },
  { id: "wild_berries", englishName: "Wild berries", kind: "berry", rarity: "common", basePrice: 3, zones: ["meadow", "forest_edge"] },
  { id: "wild_herb", englishName: "Wild herb", kind: "herb", rarity: "common", basePrice: 3, zones: ["meadow", "hill"] },
  { id: "mint", englishName: "Mint", kind: "herb", rarity: "uncommon", basePrice: 4, zones: ["riverbank"] },
  { id: "old_coin", englishName: "Old coin", kind: "rare_find", rarity: "rare", basePrice: 25, zones: ["riverbank", "hill"] },
  { id: "old_letter", englishName: "Old letter", kind: "rare_find", rarity: "rare", basePrice: 20, zones: ["hill", "square"] },
] as const satisfies readonly ForageDef[];

export type ForageId = (typeof FORAGE)[number]["id"];
export const FORAGE_IDS = FORAGE.map((f) => f.id) as readonly ForageId[];

export function getForage(id: string): ForageDef | undefined {
  return FORAGE.find((f) => f.id === id);
}

export function forageIdsOfKind(...kinds: ForageKind[]): ForageId[] {
  return FORAGE.filter((f) => (kinds as readonly string[]).includes(f.kind)).map((f) => f.id);
}

/**
 * The spawn table for a zone, weighted by rarity.
 * The daily spawns per shard are forage/spawns.ts (build plan M28).
 */
export function forageTable(zone: ForageZone): WeightedEntry<ForageId>[] {
  return (FORAGE as readonly (ForageDef & { id: ForageId })[])
    .filter((f) => f.zones.includes(zone))
    .map((f) => ({ value: f.id, weight: RARITY_WEIGHTS[f.rarity] }));
}

export interface LostItemDef {
  id: string;
  englishName: string;
  /** The NPC who lost it. Returning it earns friendship (GDD §5.3). */
  owner: NpcId;
  /** Places the Gossip can hint at ("I saw something shiny near the bridge…"). */
  hintPlaces: readonly PlaceId[];
}

/** Lost items are quest objects: they cannot be sold. Spawning and the return flow: forage/spawns.ts, forage/lost.ts (M28). */
export const LOST_ITEMS = [
  { id: "lost_glasses", englishName: "Reading glasses", owner: "librarian", hintPlaces: ["bridge", "fountain"] },
  { id: "lost_hat", englishName: "Straw hat", owner: "farmer", hintPlaces: ["river_bank", "square_bench"] },
  { id: "lost_letter", englishName: "Sealed letter", owner: "mayor", hintPlaces: ["cafe", "notice_board"] },
  { id: "lost_scarf", englishName: "Silk scarf", owner: "barista", hintPlaces: ["fountain", "bridge"] },
  { id: "lost_keys", englishName: "Shop keys", owner: "shopkeeper", hintPlaces: ["bakery", "town_square"] },
  { id: "lost_pocket_watch", englishName: "Pocket watch", owner: "elder", hintPlaces: ["fishing_dock", "library"] },
] as const satisfies readonly LostItemDef[];

export type LostItemId = (typeof LOST_ITEMS)[number]["id"];
export const LOST_ITEM_IDS = LOST_ITEMS.map((l) => l.id) as readonly LostItemId[];
