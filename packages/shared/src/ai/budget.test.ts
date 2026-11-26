import { describe, expect, it } from "vitest";
import { AI_BUDGET, AiBudgetLedgerSchema, budgetRemaining, chargeBudget, checkBudget, emptyBudgetLedger, estimateTtsSeconds } from "./budget";
import { AiUsageSchema } from "../protocol/schemas";

/** Build plan M36: per-player AI budgets (NPC turns per 10 minutes and per day, TTS seconds, cloud tokens). */

const T0 = Date.UTC(2026, 10, 26, 10, 0, 0);

describe("AI budgets", () => {
  it(`allows ${AI_BUDGET.npcTurnsPerWindow} NPC turns per ${AI_BUDGET.npcTurnWindowMs / 60_000} minutes`, () => {
    let l = emptyBudgetLedger(T0);
    for (let i = 0; i < AI_BUDGET.npcTurnsPerWindow; i++) {
      expect(checkBudget(l, "turns", T0 + i * 1000)).toEqual({ ok: true });
      l = chargeBudget(l, "turns", T0 + i * 1000);
    }
    const at = T0 + AI_BUDGET.npcTurnsPerWindow * 1000;
    expect(checkBudget(l, "turns", at)).toEqual({ ok: false, reason: "window", retryAt: T0 + AI_BUDGET.npcTurnWindowMs });
    // The oldest turn leaves the window.
    expect(checkBudget(l, "turns", T0 + AI_BUDGET.npcTurnWindowMs)).toEqual({ ok: true });
    expect(budgetRemaining(l, at).turns).toBe(0);
  });

  it("caps NPC turns per day and resets at midnight UTC", () => {
    let l = { ...emptyBudgetLedger(T0), turns: AI_BUDGET.npcTurnsPerDay };
    expect(checkBudget(l, "turns", T0)).toMatchObject({ ok: false, reason: "daily", retryAt: Date.UTC(2026, 10, 27) });
    l = chargeBudget(l, "turns", Date.UTC(2026, 10, 27, 0, 0, 1));
    expect(l).toMatchObject({ day: "2026-11-27", turns: 1 });
  });

  it("budgets TTS seconds and cloud tokens", () => {
    let l = emptyBudgetLedger(T0);
    expect(checkBudget(l, "tts", T0, AI_BUDGET.ttsSecondsPerDay)).toEqual({ ok: true });
    l = chargeBudget(l, "tts", T0, AI_BUDGET.ttsSecondsPerDay - 2);
    expect(checkBudget(l, "tts", T0, 3)).toMatchObject({ ok: false, reason: "daily" });
    expect(checkBudget(l, "tts", T0, 1)).toEqual({ ok: true });
    l = chargeBudget(l, "tokens", T0, AI_BUDGET.cloudTokensPerDay);
    expect(checkBudget(l, "tokens", T0)).toMatchObject({ ok: false });
    expect(budgetRemaining(l, T0)).toEqual({ turns: AI_BUDGET.npcTurnsPerWindow, tts: 2, tokens: 0 });
  });

  it("ignores negative and non-finite charges", () => {
    const l = chargeBudget(chargeBudget(emptyBudgetLedger(T0), "tts", T0, -50), "tokens", T0, Number.NaN);
    expect(l).toMatchObject({ ttsSeconds: 0, cloudTokens: 0 });
  });

  it("estimates speech length per script", () => {
    expect(estimateTtsSeconds("Hi")).toBe(1);
    expect(estimateTtsSeconds("Buenos días, ¿qué te pongo hoy? Tengo pan recién hecho.")).toBeGreaterThan(3);
    expect(estimateTtsSeconds("いらっしゃいませ、今日は何にしますか")).toBeGreaterThan(estimateTtsSeconds("irasshaimase"));
  });

  it("validates stored ledgers and usage reports", () => {
    expect(AiBudgetLedgerSchema.parse(emptyBudgetLedger(T0))).toEqual(emptyBudgetLedger(T0));
    expect(AiBudgetLedgerSchema.safeParse({ ...emptyBudgetLedger(T0), turns: -1 }).success).toBe(false);
    expect(AiUsageSchema.safeParse({ turns: 2, ttsSeconds: 4.5, tokens: 1200, degraded: ["tts"] }).success).toBe(true);
    expect(AiUsageSchema.safeParse({ turns: 2, ttsSeconds: -1, tokens: 0, degraded: [] }).success).toBe(false);
    expect(AiUsageSchema.safeParse({ turns: 2, ttsSeconds: 1, tokens: 0, degraded: ["coins"] }).success).toBe(false);
  });
});
