import { FISH, type FishId, isFishId } from "../data/fish";
import type { Rarity } from "../data/rarity";

/**
 * The fish encyclopedia (build plan M27, GDD §2 "Collections: fish encyclopedia"): which species
 * the player has caught, how many, and when first and last. The server keeps it
 * (`users/{uid}/collections/fish`, Admin SDK only) and sends it with `fish:log`; catches are the
 * only way in, so it is never written by a client.
 */

export interface FishLogEntry {
  count: number;
  /** ms since the Unix epoch. */
  firstMs: number;
  lastMs: number;
}

export type FishLog = Partial<Record<FishId, FishLogEntry>>;

/** Adds one catch; `first` says whether it is a new species. Returns a new log. */
export function recordCatch(log: FishLog, fishId: FishId, nowMs: number): { log: FishLog; first: boolean; entry: FishLogEntry } {
  const prev = log[fishId];
  const entry: FishLogEntry = prev ? { count: prev.count + 1, firstMs: prev.firstMs, lastMs: nowMs } : { count: 1, firstMs: nowMs, lastMs: nowMs };
  return { log: { ...log, [fishId]: entry }, first: !prev, entry };
}

export interface FishLogStats {
  species: number;
  total: number;
  /** Species caught per rarity. */
  byRarity: Record<Rarity, { caught: number; of: number }>;
}

export function fishLogStats(log: FishLog): FishLogStats {
  const byRarity: FishLogStats["byRarity"] = {
    common: { caught: 0, of: 0 },
    uncommon: { caught: 0, of: 0 },
    rare: { caught: 0, of: 0 },
    legendary: { caught: 0, of: 0 },
  };
  let species = 0;
  let total = 0;
  for (const fish of FISH) {
    const e = log[fish.id];
    byRarity[fish.rarity].of++;
    if (e && e.count > 0) {
      species++;
      total += e.count;
      byRarity[fish.rarity].caught++;
    }
  }
  return { species, total, byRarity };
}

/** Keeps only known species with sane entries (a stored log is outside our control). */
export function cleanFishLog(raw: Readonly<Record<string, FishLogEntry>>): FishLog {
  const out: FishLog = {};
  for (const [id, e] of Object.entries(raw)) {
    if (isFishId(id) && Number.isInteger(e.count) && e.count > 0) out[id] = { count: e.count, firstMs: e.firstMs, lastMs: e.lastMs };
  }
  return out;
}
