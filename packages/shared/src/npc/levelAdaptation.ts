import type { CompactionResponse } from "../ai/schemas";
import { type Level, levelToStep, MAX_LEVEL_STEP, MIN_LEVEL_STEP, stepToLevel } from "../data/difficulty";
import type { ConversationTelemetry } from "./memory";

/**
 * Level adaptation (GDD §6.4, build plan M24). After each conversation the compaction returns
 * signals (comprehension, expression, native-language use) and the client counts telemetry
 * (suggested replies vs free input, translation hovers, corrections). The server folds them into
 * a moving estimate (`langs/{lang}.levelEstimate`, on the half-step scale: 0 = A1 … 10 = C2) and
 * moves the player's level by ½ step (one entry of LEVELS) at most once per in-game day.
 *
 * All of it is untrusted input clamped into a bounded score, so a forged `npc:memory` moves the
 * level no faster than a string of perfect conversations: ½ step per in-game day.
 *
 * Weights and margins are mine (pending.md §M24).
 */

/** Conversations with fewer player turns (counted by the server) do not move the estimate. */
export const MIN_TURNS_FOR_LEVEL = 2;
/** A conversation with this many player turns or more counts fully. */
export const FULL_WEIGHT_TURNS = 6;
/** How far one full conversation moves the estimate towards its target (EMA rate). */
export const LEVEL_ESTIMATE_RATE = 0.25;
/** A perfect (or hopeless) conversation points this many half steps above (or below) the level. */
export const LEVEL_TARGET_SPAN = 1.5;
/** The estimate must be this far above (below) the level's step for the level to move. */
export const LEVEL_CHANGE_MARGIN = 0.6;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * How well the player did in one conversation, 0–1 (0.5 = the level fits), or null when the
 * conversation was too short to say. The model's own rating weighs most; leaning on suggested
 * replies, translations and corrections pulls it down, and so does falling back to the native
 * language.
 */
export function conversationPerformance(signals: CompactionResponse["signals"], telemetry: ConversationTelemetry, playerTurns: number): number | null {
  if (playerTurns < MIN_TURNS_FOR_LEVEL) return null;
  const sent = Math.max(1, telemetry.suggested + telemetry.free);
  const freeRatio = clamp01(telemetry.free / sent);
  const hoverRate = clamp01(telemetry.translationsShown / Math.max(1, telemetry.npcLines));
  const correctionRate = clamp01(telemetry.corrections / sent);
  const model = (clamp01(signals.comprehension) + clamp01(signals.expression)) / 2;
  const score = 0.5 * model + 0.2 * freeRatio + 0.15 * (1 - hoverRate) + 0.15 * (1 - correctionRate) - (signals.usedNativeLanguage ? 0.1 : 0);
  return clamp01(score);
}

/** The estimate after one conversation: an EMA towards level ± LEVEL_TARGET_SPAN, weighted by its length. */
export function updateLevelEstimate(estimate: number, level: Level, performance: number, playerTurns: number): number {
  const start = Number.isFinite(estimate) ? estimate : levelToStep(level);
  const target = levelToStep(level) + (clamp01(performance) - 0.5) * 2 * LEVEL_TARGET_SPAN;
  const weight = LEVEL_ESTIMATE_RATE * Math.min(1, Math.max(0, playerTurns) / FULL_WEIGHT_TURNS);
  const next = start + weight * (target - start);
  return Math.min(MAX_LEVEL_STEP, Math.max(MIN_LEVEL_STEP, Math.round(next * 1000) / 1000));
}

export interface LevelState {
  level: Level;
  levelEstimate: number;
  /** In-game day of the last level change (null: never). */
  levelChangedDay: number | null;
}

export interface LevelUpdate {
  state: LevelState;
  /** +1 (½ step up), −1 (½ step down) or 0. */
  change: -1 | 0 | 1;
}

/** The level after the estimate moved: ½ step at most, and at most once per in-game day. */
export function nextLevel(state: LevelState, today: number): LevelUpdate {
  if (state.levelChangedDay === today) return { state, change: 0 };
  const step = levelToStep(state.level);
  let change: -1 | 0 | 1 = 0;
  if (state.levelEstimate >= step + LEVEL_CHANGE_MARGIN && step < MAX_LEVEL_STEP) change = 1;
  else if (state.levelEstimate <= step - LEVEL_CHANGE_MARGIN && step > MIN_LEVEL_STEP) change = -1;
  if (change === 0) return { state, change };
  return { state: { ...state, level: stepToLevel(step + change), levelChangedDay: today }, change };
}

/** One conversation's effect on the level: estimate, then the capped level move. */
export function adaptLevel(state: LevelState, performance: number | null, playerTurns: number, today: number): LevelUpdate {
  if (performance === null) return { state, change: 0 };
  const levelEstimate = updateLevelEstimate(state.levelEstimate, state.level, performance, playerTurns);
  return nextLevel({ ...state, levelEstimate }, today);
}
