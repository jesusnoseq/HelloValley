/** Rarity tiers shared by fish and forage. */
export const RARITIES = ["common", "uncommon", "rare", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Relative roll weight of one species of each rarity. A table's chance for an entry is its weight
 * divided by the sum of the weights of every eligible entry.
 */
export const RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  legendary: 3,
};

export interface WeightedEntry<T> {
  value: T;
  weight: number;
}

/** Adds each entry's share of the total weight (0–1). Useful for UI odds and for tests. */
export function withChances<T>(entries: readonly WeightedEntry<T>[]): (WeightedEntry<T> & { chance: number })[] {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  return entries.map((e) => ({ ...e, chance: total > 0 ? e.weight / total : 0 }));
}
