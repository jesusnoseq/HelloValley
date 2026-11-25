import { z } from "zod";
import { getNpc, type NpcId } from "./npcs";

/** CEFR levels, easiest first. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

/**
 * Player and effective levels in half-CEFR steps (GDD §6.4): `A1+` sits halfway between A1 and A2.
 * Index in this array = number of half steps above A1.
 */
export const LEVELS = ["A1", "A1+", "A2", "A2+", "B1", "B1+", "B2", "B2+", "C1", "C1+", "C2"] as const;
export type Level = (typeof LEVELS)[number];
export const LevelSchema = z.enum(LEVELS);

export const MIN_LEVEL_STEP = 0;
export const MAX_LEVEL_STEP = LEVELS.length - 1;

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** Half steps above A1 (A1 = 0, A1+ = 1, A2 = 2, …, C2 = 10). */
export function levelToStep(level: Level): number {
  return LEVELS.indexOf(level);
}

/** The level at a half-step index, clamped to A1..C2. Fractions round down. */
export function stepToLevel(step: number): Level {
  const clamped = Number.isFinite(step) ? Math.min(MAX_LEVEL_STEP, Math.max(MIN_LEVEL_STEP, Math.floor(step))) : 0;
  return LEVELS[clamped] as Level;
}

/** The whole CEFR level a half-step level belongs to (`B1+` → `B1`). Used in prompts. */
export function cefrOf(level: Level): Cefr {
  return level.replace("+", "") as Cefr;
}

/** A, B or C: the band used for cached openers (npc-runtime.md §2). */
export function levelBand(level: Level): "A" | "B" | "C" {
  return level[0] as "A" | "B" | "C";
}

/** Moves a level by `halfSteps` (positive = harder), clamped to A1..C2. */
export function shiftLevel(level: Level, halfSteps: number): Level {
  return stepToLevel(levelToStep(level) + Math.trunc(halfSteps));
}

export interface EffectiveLevel {
  level: Level;
  cefr: Cefr;
  /**
   * True when the NPC's offset would take the line below A1. The offset is absorbed (the level stays
   * A1) and the line is simplified further, keeping the personality (GDD §6.4).
   */
  simplified: boolean;
}

/** effectiveLevel = clamp(playerLevel + npcTierOffset, A1, C2), with offsets in half-CEFR steps. */
export function effectiveLevelInfo(playerLevel: Level, npcId: NpcId): EffectiveLevel {
  const raw = levelToStep(playerLevel) + getNpc(npcId).tierOffset;
  const level = stepToLevel(raw);
  return { level, cefr: cefrOf(level), simplified: raw < MIN_LEVEL_STEP };
}

export function effectiveLevel(playerLevel: Level, npcId: NpcId): Level {
  return effectiveLevelInfo(playerLevel, npcId).level;
}
