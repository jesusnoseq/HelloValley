import type { FishId, FishingSpot } from "../data/fish";
import type { Rarity } from "../data/rarity";
import type { SpaceId } from "../world/player";
import type { Vec2 } from "../world/town";
import { BITE_WINDOW_MS, minReelMs, REEL_MAX_S } from "./reel";

/**
 * The server's pacing and timing checks for a cast (build plan M27). The client runs the bite and
 * the mini-game, so the server cannot see the reel itself; what it can check is time and place:
 * a catch is reported no sooner than the bite plus the shortest possible reel, no later than the
 * cast's expiry, from where the line was cast, for the one cast the server rolled. Anything else
 * (an unknown or reused cast id, a made-up fish, a catch reported too fast) is refused.
 */

/** After a cast ends, the next one may start this long later (ms, my number). */
export const CAST_COOLDOWN_MS = 1500;
/** Reports may arrive this much earlier than the fastest possible reel (clock and frame jitter). */
export const REEL_EARLY_SLACK_MS = 250;
/** Extra time after the longest possible reel before the cast expires (network delay). */
export const REEL_LATE_SLACK_MS = 3000;
/** Walking further than this from where the line was cast ends the cast. */
export const CAST_MOVE_TOLERANCE_M = 1;

export type FishCastRefusal = "no_rod" | "not_at_spot" | "no_water" | "busy" | "cooldown" | "talking" | "unavailable";
export type FishReelRefusal = "no_cast" | "too_soon" | "too_late" | "moved";

/** What the server remembers about a cast it rolled. */
export interface PendingCast {
  castId: string;
  fishId: FishId;
  rarity: Rarity;
  spot: FishingSpot;
  castAtMs: number;
  biteAtMs: number;
  /** Where the player stood. */
  pos: Vec2;
  bobber: Vec2;
}

/** A cast nobody reported on is dropped at this time. */
export function castExpiresAt(cast: Pick<PendingCast, "biteAtMs" | "rarity">): number {
  return cast.biteAtMs + BITE_WINDOW_MS[cast.rarity] + REEL_MAX_S * 1000 + REEL_LATE_SLACK_MS;
}

/** The earliest time a catch of this cast can be reported. */
export function earliestCatchAt(cast: Pick<PendingCast, "biteAtMs" | "rarity">): number {
  return cast.biteAtMs + minReelMs(cast.rarity) - REEL_EARLY_SLACK_MS;
}

export type ReelVerdict = { ok: true } | { ok: false; reason: FishReelRefusal };

/**
 * Judges a `fish:reel` report against the pending cast and the player's server-side position.
 * An escape is always accepted (the player may give up at any time); a catch must fit the timing.
 */
export function judgeReel(cast: PendingCast | undefined, castId: string, outcome: "caught" | "escaped", nowMs: number, space: SpaceId, pos: Vec2): ReelVerdict {
  if (!cast || cast.castId !== castId) return { ok: false, reason: "no_cast" };
  if (outcome === "escaped") return { ok: true };
  if (nowMs > castExpiresAt(cast)) return { ok: false, reason: "too_late" };
  if (space !== "town" || Math.hypot(pos[0] - cast.pos[0], pos[1] - cast.pos[1]) > CAST_MOVE_TOLERANCE_M) return { ok: false, reason: "moved" };
  if (nowMs < earliestCatchAt(cast)) return { ok: false, reason: "too_soon" };
  return { ok: true };
}
