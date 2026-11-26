import { type FishId, fishTable, type FishingConditions, getFish } from "../data/fish";
import type { Rarity, WeightedEntry } from "../data/rarity";
import { pickWeighted, type Rng } from "./rng";

/**
 * The server's roll for one cast (build plan M27, GDD §5.2): which fish bites and when. The
 * species comes from the shared rarity table for the time of day, weather and spot (data/fish.ts),
 * so the client can never choose it; it learns the fish only when it lands one.
 */

/** A full-distance cast multiplies the weight of rare and legendary fish by 1 + this (deeper water, my number). */
export const DISTANCE_RARE_BONUS = 1;
/** The bite comes this long after the cast (ms, uniform; GDD §5.2 "wait, the fish shadow approaches"). */
export const BITE_DELAY_MIN_MS = 2000;
export const BITE_DELAY_MAX_MS = 6000;

/** Fish shadow size by rarity: the hint the player sees while the fish approaches. */
export const FISH_SHADOWS = ["small", "medium", "large"] as const;
export type FishShadow = (typeof FISH_SHADOWS)[number];
export const SHADOW_FOR_RARITY: Readonly<Record<Rarity, FishShadow>> = {
  common: "small",
  uncommon: "medium",
  rare: "large",
  legendary: "large",
};

/** The table for one cast: the species that bite in these conditions, rare ones boosted by the cast distance (0–1). */
export function castTable(conditions: FishingConditions, distance01: number): WeightedEntry<FishId>[] {
  const d = Math.min(1, Math.max(0, Number.isFinite(distance01) ? distance01 : 0));
  // TODO(M29): the fish stew buff ("better fishing luck", GDD §5.4) boosts rare fish here too.
  return fishTable(conditions).map((e) => {
    const rarity = getFish(e.value)!.rarity;
    const boosted = rarity === "rare" || rarity === "legendary";
    return boosted ? { value: e.value, weight: e.weight * (1 + DISTANCE_RARE_BONUS * d) } : e;
  });
}

export interface CastRoll {
  fishId: FishId;
  rarity: Rarity;
  /** From the cast to the bite. */
  biteDelayMs: number;
  /** Seeds the reel zone's movement (the client draws the same zone the rules assume). */
  reelSeed: number;
}

/** Rolls a cast, or null when nothing bites here (never in the town: minnows bite everywhere). */
export function rollCast(conditions: FishingConditions, distance01: number, rng: Rng): CastRoll | null {
  const fishId = pickWeighted(castTable(conditions, distance01), rng);
  if (!fishId) return null;
  const biteDelayMs = Math.round(BITE_DELAY_MIN_MS + (BITE_DELAY_MAX_MS - BITE_DELAY_MIN_MS) * rng());
  const reelSeed = Math.floor(rng() * 2 ** 31);
  return { fishId, rarity: getFish(fishId)!.rarity, biteDelayMs, reelSeed };
}
