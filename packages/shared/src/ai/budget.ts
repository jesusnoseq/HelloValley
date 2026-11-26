import { z } from "zod";

/**
 * Per-player AI budgets (GDD §9.2 "server guards", build plan M36) mapped onto architecture §9:
 * the game server is not on the AI request path, so it cannot cap spending itself. The hard caps
 * are App Check on AI Logic, the AI Logic per-user rate limit and the project quotas (console,
 * docs/deploy.md, build plan M38). On top of those:
 *
 * - **NPC turns** are enforced by the server: it issues turn ids, and refuses `npc:start` and
 *   `npc:reply` past the window and daily limits (a model call without a turn id has no game effect).
 * - **TTS seconds and cloud tokens** are budgeted on the client, which is where the calls happen:
 *   an honest client stops calling the model once a budget is used up and degrades gracefully
 *   (NPC turns → canned "busy" lines, voices → text only with the 🔇 badge, small tasks →
 *   on-device only or cached answers). The client reports its usage (`ai:usage`) so the server
 *   metrics show it, clamped as untrusted numbers.
 *
 * All budgets reset at 00:00 UTC. Pure: the callers pass the clock.
 */

export interface AiBudgetLimits {
  npcTurnsPerWindow: number;
  npcTurnWindowMs: number;
  npcTurnsPerDay: number;
  ttsSecondsPerDay: number;
  cloudTokensPerDay: number;
}

export const AI_BUDGET: Readonly<AiBudgetLimits> = {
  /** GDD §9.2: "for example 30 NPC turns per 10 min". */
  npcTurnsPerWindow: 30,
  npcTurnWindowMs: 10 * 60_000,
  /** NPC turns per UTC day across all NPCs (the M21 number). */
  npcTurnsPerDay: 300,
  /** Generated speech per UTC day (seconds of audio; seeded and cached clips are free). My number. */
  ttsSecondsPerDay: 15 * 60,
  /** Cloud tokens per UTC day (NPC turns, openers and cloud fallbacks of the small tasks). My number. */
  cloudTokensPerDay: 250_000,
};

export type AiBudgetKind = "turns" | "tts" | "tokens";
export const AI_BUDGET_KINDS = ["turns", "tts", "tokens"] as const satisfies readonly AiBudgetKind[];

export interface AiBudgetLedger {
  /** UTC day (`YYYY-MM-DD`) the totals belong to. */
  day: string;
  /** Clocks (ms) of the NPC turns inside the window, oldest first. */
  turnTimes: number[];
  turns: number;
  ttsSeconds: number;
  cloudTokens: number;
}

export const utcDayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

export function emptyBudgetLedger(now: number): AiBudgetLedger {
  return { day: utcDayOf(now), turnTimes: [], turns: 0, ttsSeconds: 0, cloudTokens: 0 };
}

/** The ledger for `now`: a new day starts empty, old window entries drop out. */
export function currentLedger(ledger: AiBudgetLedger, now: number): AiBudgetLedger {
  if (ledger.day !== utcDayOf(now)) return emptyBudgetLedger(now);
  return { ...ledger, turnTimes: ledger.turnTimes.filter((t) => now - t < AI_BUDGET.npcTurnWindowMs && t <= now) };
}

export type BudgetCheck = { ok: true } | { ok: false; reason: "window" | "daily"; /** When the budget frees up again (ms). */ retryAt: number };

const nextUtcMidnight = (now: number) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

/** May `amount` more of `kind` be spent now? (Turns: one at a time.) */
export function checkBudget(ledger: AiBudgetLedger, kind: AiBudgetKind, now: number, amount = kind === "turns" ? 1 : 0): BudgetCheck {
  const l = currentLedger(ledger, now);
  const daily = { ok: false, reason: "daily", retryAt: nextUtcMidnight(now) } as const;
  switch (kind) {
    case "turns":
      if (l.turns + amount > AI_BUDGET.npcTurnsPerDay) return daily;
      if (l.turnTimes.length + amount > AI_BUDGET.npcTurnsPerWindow) return { ok: false, reason: "window", retryAt: l.turnTimes[0]! + AI_BUDGET.npcTurnWindowMs };
      return { ok: true };
    case "tts":
      return l.ttsSeconds + amount > AI_BUDGET.ttsSecondsPerDay || l.ttsSeconds >= AI_BUDGET.ttsSecondsPerDay ? daily : { ok: true };
    case "tokens":
      return l.cloudTokens + amount > AI_BUDGET.cloudTokensPerDay || l.cloudTokens >= AI_BUDGET.cloudTokensPerDay ? daily : { ok: true };
  }
}

/** Records spending (the input is not changed). Amounts below zero count as zero. */
export function chargeBudget(ledger: AiBudgetLedger, kind: AiBudgetKind, now: number, amount = kind === "turns" ? 1 : 0): AiBudgetLedger {
  const l = currentLedger(ledger, now);
  const a = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  switch (kind) {
    case "turns":
      return { ...l, turns: l.turns + a, turnTimes: [...l.turnTimes, ...Array.from({ length: Math.round(a) }, () => now)] };
    case "tts":
      return { ...l, ttsSeconds: l.ttsSeconds + a };
    case "tokens":
      return { ...l, cloudTokens: l.cloudTokens + Math.round(a) };
  }
}

/** What is left of each budget today (for the HUD and the usage report). */
export function budgetRemaining(ledger: AiBudgetLedger, now: number): Record<AiBudgetKind, number> {
  const l = currentLedger(ledger, now);
  return {
    turns: Math.max(0, Math.min(AI_BUDGET.npcTurnsPerDay - l.turns, AI_BUDGET.npcTurnsPerWindow - l.turnTimes.length)),
    tts: Math.max(0, AI_BUDGET.ttsSecondsPerDay - l.ttsSeconds),
    tokens: Math.max(0, AI_BUDGET.cloudTokensPerDay - l.cloudTokens),
  };
}

/** Characters each script speaks per second, roughly (CJK characters carry a syllable or more each). */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** A TTS clip's length before it exists (to check the budget; the real length is charged after). */
export function estimateTtsSeconds(text: string): number {
  let units = 0;
  for (const c of text) units += CJK.test(c) ? 2.5 : /\s/.test(c) ? 0.5 : 1;
  // About 14 Latin characters a second at a calm pace, at least one second per clip.
  return Math.max(1, Math.round((units / 14) * 10) / 10);
}

/** Restores a stored ledger (client storage can hold anything an old build wrote). */
export const AiBudgetLedgerSchema = z.strictObject({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turnTimes: z.array(z.number().int().min(0)).max(AI_BUDGET.npcTurnsPerWindow * 2),
  turns: z.number().int().min(0).max(100_000),
  ttsSeconds: z.number().min(0).max(1e7),
  cloudTokens: z.number().int().min(0).max(1e10),
});
