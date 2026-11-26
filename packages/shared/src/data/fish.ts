import { RARITY_WEIGHTS, type Rarity, type WeightedEntry } from "./rarity";
import { TIMES_OF_DAY, WEATHERS, type TimeOfDay, type Weather } from "./world";

/** Where the line is cast. Secret spots are unlocked by friendship with the Elder (GDD §5.2). */
export const FISHING_SPOTS = ["dock", "bank", "secret"] as const;
export type FishingSpot = (typeof FISHING_SPOTS)[number];

export interface FishDef {
  id: string;
  englishName: string;
  rarity: Rarity;
  /** Sell price in coins. */
  basePrice: number;
  times: readonly TimeOfDay[];
  weather: readonly Weather[];
  spots: readonly FishingSpot[];
}

const ALL_DAY = TIMES_OF_DAY;
const ANY_WEATHER = WEATHERS;
const OPEN_WATER = ["dock", "bank", "secret"] as const;

/** 18 river species (GDD §5.2). Each one is also an inventory item (see items.ts). */
export const FISH = [
  { id: "minnow", englishName: "Minnow", rarity: "common", basePrice: 2, times: ALL_DAY, weather: ANY_WEATHER, spots: OPEN_WATER },
  { id: "roach", englishName: "Roach", rarity: "common", basePrice: 3, times: ["morning", "afternoon", "evening"], weather: ANY_WEATHER, spots: OPEN_WATER },
  { id: "perch", englishName: "Perch", rarity: "common", basePrice: 4, times: ["morning", "afternoon"], weather: ANY_WEATHER, spots: OPEN_WATER },
  { id: "bream", englishName: "Bream", rarity: "common", basePrice: 4, times: ["afternoon", "evening"], weather: ANY_WEATHER, spots: OPEN_WATER },
  { id: "carp", englishName: "Carp", rarity: "common", basePrice: 5, times: ALL_DAY, weather: ANY_WEATHER, spots: OPEN_WATER },
  { id: "crayfish", englishName: "Crayfish", rarity: "common", basePrice: 5, times: ["evening", "night"], weather: ANY_WEATHER, spots: ["bank", "secret"] },
  { id: "trout", englishName: "Trout", rarity: "uncommon", basePrice: 10, times: ["morning", "evening"], weather: ["sun", "rain"], spots: OPEN_WATER },
  { id: "bass", englishName: "Bass", rarity: "uncommon", basePrice: 10, times: ["afternoon", "evening"], weather: ["sun", "fog"], spots: OPEN_WATER },
  { id: "tench", englishName: "Tench", rarity: "uncommon", basePrice: 12, times: ["morning", "evening"], weather: ["fog", "rain"], spots: OPEN_WATER },
  { id: "catfish", englishName: "Catfish", rarity: "uncommon", basePrice: 12, times: ["evening", "night"], weather: ANY_WEATHER, spots: ["dock", "secret"] },
  { id: "pike", englishName: "Pike", rarity: "uncommon", basePrice: 15, times: ["morning", "afternoon"], weather: ["rain", "fog"], spots: OPEN_WATER },
  { id: "eel", englishName: "Eel", rarity: "uncommon", basePrice: 15, times: ["night"], weather: ["rain", "fog"], spots: OPEN_WATER },
  { id: "salmon", englishName: "Salmon", rarity: "rare", basePrice: 30, times: ["morning"], weather: ["rain"], spots: OPEN_WATER },
  { id: "golden_carp", englishName: "Golden carp", rarity: "rare", basePrice: 35, times: ["afternoon"], weather: ["sun"], spots: OPEN_WATER },
  { id: "sturgeon", englishName: "Sturgeon", rarity: "rare", basePrice: 40, times: ["night"], weather: ANY_WEATHER, spots: ["dock", "secret"] },
  { id: "moon_trout", englishName: "Moon trout", rarity: "rare", basePrice: 40, times: ["night"], weather: ["sun"], spots: ["secret"] },
  { id: "rainbow_koi", englishName: "Rainbow koi", rarity: "legendary", basePrice: 100, times: ["afternoon"], weather: ["rain"], spots: ["secret"] },
  { id: "ghost_pike", englishName: "Ghost pike", rarity: "legendary", basePrice: 100, times: ["night"], weather: ["fog"], spots: ["secret"] },
] as const satisfies readonly FishDef[];

export type FishId = (typeof FISH)[number]["id"];
export const FISH_IDS = FISH.map((f) => f.id) as readonly FishId[];

export function getFish(id: string): FishDef | undefined {
  return FISH.find((f) => f.id === id);
}

export function isFishId(value: unknown): value is FishId {
  return typeof value === "string" && (FISH_IDS as readonly string[]).includes(value);
}

export interface FishingConditions {
  timeOfDay: TimeOfDay;
  weather: Weather;
  spot: FishingSpot;
}

/**
 * The rarity table for a cast: every species that bites in these conditions, weighted by rarity.
 * The server rolls on it (fishing/roll.ts, build plan M27: seeded RNG, distance bonus, bite timing).
 * Build plan M29: the fishing-luck buff boosts rarer fish in `castTable`.
 */
export function fishTable(conditions: FishingConditions): WeightedEntry<FishId>[] {
  const table: WeightedEntry<FishId>[] = [];
  for (const fish of FISH as readonly (FishDef & { id: FishId })[]) {
    if (
      fish.times.includes(conditions.timeOfDay) &&
      fish.weather.includes(conditions.weather) &&
      fish.spots.includes(conditions.spot)
    ) {
      table.push({ value: fish.id, weight: RARITY_WEIGHTS[fish.rarity] });
    }
  }
  return table;
}
