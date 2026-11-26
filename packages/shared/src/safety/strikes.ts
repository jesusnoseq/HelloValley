/**
 * Strikes and shard-wide mutes for repeat offenders (GDD §9.3, build plan M36, architecture §6.4).
 * Pure: the game server keeps one standing per player (in memory and in the server-only
 * `users/{uid}/safety/standing`), passes the clock, and refuses the chat of a muted player in every
 * shard ("muted shard-wide": the mute follows the player, so hopping to another valley does not
 * lift it).
 *
 * Strikes come from lines the server moderation blocked (weighted by category, moderation.ts) and
 * from reports by other players (one per distinct reporter per window, so one angry player cannot
 * mute anyone alone). Enough weight inside the window mutes the player; each new mute within a week
 * of the last one lasts longer.
 */

export type StrikeKind = "moderation" | "report";

export interface Strike {
  at: number;
  weight: number;
  kind: StrikeKind;
  /** The reporter, for report strikes. */
  by?: string;
}

export interface ModerationStanding {
  /** Strikes inside the window, oldest first. */
  strikes: Strike[];
  /** Clock (ms) the current mute ends, or null. */
  muteUntil: number | null;
  /** Mutes so far in this escalation (resets after MUTE_LEVEL_RESET_MS without one). */
  mutes: number;
  lastMuteAt: number | null;
}

/** Strikes older than this no longer count (my number). */
export const STRIKE_WINDOW_MS = 30 * 60_000;
/** Strike weight inside the window that mutes a player (my number). */
export const MUTE_STRIKE_THRESHOLD = 3;
/** Mute lengths by escalation: 10 minutes, 1 hour, 24 hours (my numbers). */
export const MUTE_DURATIONS_MS = [10 * 60_000, 60 * 60_000, 24 * 60 * 60_000] as const;
/** A week without a mute starts the escalation again. */
export const MUTE_LEVEL_RESET_MS = 7 * 24 * 60 * 60_000;
/** Strikes kept per player (the stored list is bounded). */
export const MAX_STRIKES_KEPT = 20;

export function emptyStanding(): ModerationStanding {
  return { strikes: [], muteUntil: null, mutes: 0, lastMuteAt: null };
}

/** When the mute ends, or null when the player may chat. */
export function mutedUntil(standing: ModerationStanding, now: number): number | null {
  return standing.muteUntil !== null && standing.muteUntil > now ? standing.muteUntil : null;
}

export interface StrikeOutcome {
  standing: ModerationStanding;
  /** Whether the strike counted (a second report by the same reporter in the window does not). */
  counted: boolean;
  /** Set when this strike started a mute. */
  muted: { until: number; level: number } | null;
}

/** Adds a strike; returns the new standing (the input is not changed). */
export function addStrike(standing: ModerationStanding, strike: Strike, now: number): StrikeOutcome {
  const strikes = standing.strikes.filter((s) => now - s.at < STRIKE_WINDOW_MS);
  const base: ModerationStanding = { ...standing, strikes };
  const duplicateReport = strike.kind === "report" && strikes.some((s) => s.kind === "report" && s.by === strike.by);
  if (strike.weight <= 0 || duplicateReport) return { standing: base, counted: false, muted: null };
  const next = [...strikes, { ...strike, at: now }].slice(-MAX_STRIKES_KEPT);
  // While muted, strikes still count toward the next mute but do not stack mutes.
  if (mutedUntil(standing, now) !== null) return { standing: { ...base, strikes: next }, counted: true, muted: null };
  const weight = next.reduce((n, s) => n + s.weight, 0);
  if (weight < MUTE_STRIKE_THRESHOLD) return { standing: { ...base, strikes: next }, counted: true, muted: null };
  const escalating = standing.lastMuteAt !== null && now - standing.lastMuteAt < MUTE_LEVEL_RESET_MS;
  const level = escalating ? standing.mutes + 1 : 1;
  const until = now + MUTE_DURATIONS_MS[Math.min(level, MUTE_DURATIONS_MS.length) - 1]!;
  return { standing: { strikes: [], muteUntil: until, mutes: level, lastMuteAt: now }, counted: true, muted: { until, level } };
}
