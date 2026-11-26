import { AI_BUDGET, INFERENCE_MODES, type TtsRequest } from "@hellovalley/shared";
import { describe, expect, it, vi } from "vitest";
import { BAKER_ES_A1_REPLY, npcContextFixture } from "../../../shared/src/npc/fixtures";
import { attachAiUsageReports } from "../net/aiUsage";
import { type AiBudget, budgetStorageKey, createAiBudget, type KeyValueStore } from "./budget";
import { createHybridAI, type ModelRequest } from "./hybrid";
import { createNpcTurnRunner, type TemplateChatPort } from "./templates";
import { createTts, type TtsLineRequest } from "./tts";

/**
 * Build plan M36: the client's AI budgets (NPC turns, TTS seconds, cloud tokens) and the graceful
 * degradation once one is used up: canned NPC lines, text-only voices, on-device-only small tasks.
 */

const T0 = Date.UTC(2026, 10, 26, 9, 0, 0);
const memoryStorage = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

/** A budget with one kind already used up. */
function spent(kind: "turns" | "tts" | "tokens", clock = { now: T0 }): AiBudget {
  const b = createAiBudget({ now: () => clock.now });
  if (kind === "turns") for (let i = 0; i < AI_BUDGET.npcTurnsPerWindow; i++) b.charge("turns");
  if (kind === "tts") b.charge("tts", AI_BUDGET.ttsSecondsPerDay);
  if (kind === "tokens") b.charge("tokens", AI_BUDGET.cloudTokensPerDay);
  return b;
}

describe("the client AI budget", () => {
  it("persists per player, survives a reload and resets the next UTC day", () => {
    const storage = memoryStorage();
    const clock = { now: T0 };
    const a = createAiBudget({ storage, key: budgetStorageKey("lia"), now: () => clock.now });
    a.charge("tts", 30);
    a.charge("tokens", 1000);
    const b = createAiBudget({ storage, key: budgetStorageKey("lia"), now: () => clock.now });
    expect(b.remaining()).toMatchObject({ tts: AI_BUDGET.ttsSecondsPerDay - 30, tokens: AI_BUDGET.cloudTokensPerDay - 1000 });
    clock.now = Date.UTC(2026, 10, 27, 0, 0, 1);
    expect(b.remaining()).toMatchObject({ tts: AI_BUDGET.ttsSecondsPerDay, tokens: AI_BUDGET.cloudTokensPerDay });
  });

  it("starts fresh on unreadable or throwing storage", () => {
    const broken: KeyValueStore = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("quota");
      },
    };
    const b = createAiBudget({ storage: broken, now: () => T0 });
    expect(() => b.charge("tokens", 5)).not.toThrow();
    expect(b.remaining().tokens).toBe(AI_BUDGET.cloudTokensPerDay - 5);
  });

  it("reports what was spent and which budgets ran out, once", () => {
    const b = spent("tts");
    b.charge("tokens", 120);
    expect(b.allow("tts", 3)).toBe(false);
    expect(b.drain()).toEqual({ turns: 0, ttsSeconds: AI_BUDGET.ttsSecondsPerDay, tokens: 120, degraded: ["tts"] });
    expect(b.drain()).toBeNull();
  });
});

describe("graceful degradation", () => {
  it("NPC turns: no turns or tokens left → the canned 'busy' line, no model call", async () => {
    for (const kind of ["turns", "tokens"] as const) {
      const chat = vi.fn<TemplateChatPort>();
      const runner = createNpcTurnRunner({ chat, cloudEnabled: true, budget: spent(kind) });
      const r = await runner.run({ context: npcContextFixture({ lang: "es", playerLevel: "A1" }), player: { name: "Lia", animal: "fox", apartmentId: "3B" }, history: [], playerText: "Hola", method: "typed" });
      expect(r).toMatchObject({ ok: false, reason: "unavailable" });
      expect(!r.ok && r.fallback?.text).toBeTruthy();
      expect(chat).not.toHaveBeenCalled();
    }
  });

  it("NPC turns are charged one turn plus their tokens", async () => {
    const budget = createAiBudget({ now: () => T0 });
    const answer = JSON.stringify(BAKER_ES_A1_REPLY);
    const chat: TemplateChatPort = () => (async function* () { yield answer; })();
    const runner = createNpcTurnRunner({ chat, cloudEnabled: true, budget });
    const r = await runner.run({ context: npcContextFixture({ lang: "es", playerLevel: "A1" }), player: { name: "Lia", animal: "fox", apartmentId: "3B" }, history: [], playerText: "Quiero pan", method: "typed" });
    expect(r.ok).toBe(true);
    const report = budget.drain()!;
    expect(report.turns).toBe(1);
    expect(report.tokens).toBeGreaterThan(answer.length / 4);
  });

  it("TTS: no seconds left → text only (unavailable), but cached clips still play", async () => {
    const pcm = new Uint8Array(new Int16Array(2400).buffer);
    const port = vi.fn(async (_r: TtsRequest) => ({ mime: "audio/L16;codec=pcm;rate=24000", data: pcm }));
    const budget = createAiBudget({ now: () => T0 });
    const tts = createTts({ port, cloudEnabled: true, persistent: null, budget, log: () => {} });
    const line: TtsLineRequest = { npcId: "baker", lang: "es", level: "A1", text: "¡Hola!" };
    expect(await tts.clip(line)).toMatchObject({ ok: true, source: "generated" });
    expect(budget.drain()!.ttsSeconds).toBeCloseTo(0.1, 1);
    budget.charge("tts", AI_BUDGET.ttsSecondsPerDay);
    expect(await tts.clip({ ...line, text: "¿Qué te pongo?" })).toEqual({ ok: false, reason: "unavailable" });
    expect(await tts.clip(line)).toMatchObject({ ok: true, source: "memory" });
    expect(port).toHaveBeenCalledTimes(1);
  });

  it("small tasks: no tokens left → on-device only; cloud answers are charged", async () => {
    const calls: ModelRequest[] = [];
    const model = vi.fn(async (request: ModelRequest) => {
      calls.push(request);
      return { text: JSON.stringify({ translation: "Hello" }), source: "cloud" as const };
    });
    const budget = createAiBudget({ now: () => T0 });
    const ai = createHybridAI({ model, onDeviceReady: () => true, cloudEnabled: true, budget, warn: () => {} });
    const long = Array(30).fill("palabra").join(" ");
    await ai.translate({ text: long, from: "es", to: "en" });
    expect(calls[0]!.mode).toBe(INFERENCE_MODES.PREFER_IN_CLOUD);
    expect(budget.drain()!.tokens).toBeGreaterThan(0);
    budget.charge("tokens", AI_BUDGET.cloudTokensPerDay);
    await ai.translate({ text: `${long} otra`, from: "es", to: "en" });
    expect(calls[1]!.mode).toBe(INFERENCE_MODES.ONLY_ON_DEVICE);
    // Without the on-device model there is nothing left to run: the task's fallback applies.
    const offline = createHybridAI({ model, onDeviceReady: () => false, cloudEnabled: true, budget, warn: () => {} });
    expect(await offline.translate({ text: "Hola amigo", from: "es", to: "en" })).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("ai:usage reports", () => {
  it("sends the drained usage once a minute while the room is open", async () => {
    vi.useFakeTimers();
    try {
      const sent: [string, unknown][] = [];
      const room = { connection: { isOpen: true }, send: (t: string, p: unknown) => void sent.push([t, p]) };
      const usage = { turns: 1, ttsSeconds: 2, tokens: 300, degraded: [] };
      const drain = vi.fn().mockResolvedValueOnce(usage).mockResolvedValue(null);
      const stop = attachAiUsageReports(room, drain, 60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sent).toEqual([["ai:usage", usage]]);
      stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(drain).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
