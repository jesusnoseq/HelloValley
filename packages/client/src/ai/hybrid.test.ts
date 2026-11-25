import { INFERENCE_MODES, ROUTING_TABLE } from "@hellovalley/shared";
import { InferenceMode } from "firebase/ai";
import { describe, expect, it, vi } from "vitest";
import { createContentCache, type PersistentStore } from "./cache";
import { createHybridAI, type HybridDeps, type ModelAnswer, type ModelRequest } from "./hybrid";
import { hybridModeration } from "./moderation";
import { hybridTranslator } from "./translate";

/** A mocked model: answers in order (a string is the JSON text, an Error is thrown). */
function mockModel(...answers: (string | Error)[]) {
  const calls: ModelRequest[] = [];
  const model = vi.fn(async (request: ModelRequest): Promise<ModelAnswer> => {
    calls.push(request);
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    if (next === undefined) throw new Error("no answer scripted");
    if (next instanceof Error) throw next;
    return { text: next, source: request.mode === INFERENCE_MODES.ONLY_ON_DEVICE || request.mode === INFERENCE_MODES.PREFER_ON_DEVICE ? "on-device" : "cloud" };
  });
  return { model, calls };
}

const memoryStore = (): PersistentStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
};

const make = (model: HybridDeps["model"], over: Partial<HybridDeps> = {}) =>
  createHybridAI({ model, onDeviceReady: () => true, cloudEnabled: true, warn: () => {}, ...over });

const translation = (t: string) => JSON.stringify({ translation: t });

describe("InferenceMode values", () => {
  it("match Firebase AI Logic", () => {
    expect(INFERENCE_MODES).toEqual({
      PREFER_ON_DEVICE: InferenceMode.PREFER_ON_DEVICE,
      ONLY_ON_DEVICE: InferenceMode.ONLY_ON_DEVICE,
      ONLY_IN_CLOUD: InferenceMode.ONLY_IN_CLOUD,
      PREFER_IN_CLOUD: InferenceMode.PREFER_IN_CLOUD,
    });
  });
});

describe("hybrid tasks with a mocked model", () => {
  it("sends one single-turn prompt with the task's mode and schema", async () => {
    const { model, calls } = mockModel(translation("Hello"));
    const ai = make(model);
    const r = await ai.translate({ text: "Hola", from: "es", to: "en" });
    expect(r).toEqual({ ok: true, value: { translation: "Hello" }, source: "on-device" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ task: "translateShort", mode: ROUTING_TABLE.translateShort.mode });
    expect(calls[0]!.prompt).toContain("<player_text>Hola</player_text>");
    expect(calls[0]!.schema.required).toEqual(["translation"]);
  });

  it("routes long text to the cloud first", async () => {
    const { model, calls } = mockModel(translation("Long"));
    await make(model).translate({ text: Array(30).fill("palabra").join(" "), from: "es", to: "en" });
    expect(calls[0]).toMatchObject({ task: "translateLong", mode: INFERENCE_MODES.PREFER_IN_CLOUD });
  });

  it("retries once after invalid JSON, a bad shape or a thrown error", async () => {
    for (const bad of ["not json", '{"translation":""}', new Error("network")]) {
      const { model } = mockModel(bad, translation("Hi"));
      const r = await make(model).translate({ text: "Hola", from: "es", to: "en" });
      expect(r).toMatchObject({ ok: true, value: { translation: "Hi" } });
      expect(model).toHaveBeenCalledTimes(2);
    }
  });

  it("gives up after the retry and reports a failure", async () => {
    const warn = vi.fn();
    const { model } = mockModel("nope", "still nope", translation("too late"));
    const r = await make(model, { warn }).translate({ text: "Hola", from: "es", to: "en" });
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(model).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("skips ONLY_ON_DEVICE tasks without a ready model, with no model call", async () => {
    const { model } = mockModel('{"ok":true}');
    const ai = make(model, { onDeviceReady: () => false });
    expect(await ai.grammarFeedback({ text: "Yo quiero pan", nativeLang: "en", targetLang: "es", level: "A1" })).toEqual({ ok: false, reason: "unavailable" });
    expect(await ai.moderate({ text: "hi", side: "reader" })).toEqual({ ok: false, reason: "unavailable" });
    expect(await ai.personaliseOpener({ targetLang: "es", level: "A1", cachedOpener: "¡Hola!", memorySummary: "" })).toEqual({ ok: false, reason: "unavailable" });
    expect(model).not.toHaveBeenCalled();
  });

  it("lets PREFER_ON_DEVICE tasks fall back to the cloud when the model is not ready", async () => {
    const { model, calls } = mockModel('{"ok":true}');
    const r = await make(model, { onDeviceReady: () => false }).moderate({ text: "hi", side: "sender" });
    expect(r.ok).toBe(true);
    expect(calls[0]!.mode).toBe(INFERENCE_MODES.PREFER_ON_DEVICE);
  });

  it("runs on-device only without a cloud backend, and not at all without either", async () => {
    const { model, calls } = mockModel(translation("Hi"));
    await make(model, { cloudEnabled: false }).translate({ text: "Hola", from: "es", to: "en" });
    expect(calls[0]!.mode).toBe(INFERENCE_MODES.ONLY_ON_DEVICE);
    const none = make(model, { cloudEnabled: false, onDeviceReady: () => false });
    expect(await none.translate({ text: "Hola", from: "es", to: "en" })).toEqual({ ok: false, reason: "unavailable" });
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("validates every task's answer", async () => {
    const ai = make(
      mockModel(
        JSON.stringify({ tokens: [{ surface: "Hola", gloss: "hello", pos: "interj" }], translation: "Hello" }),
      ).model,
    );
    const g = await ai.gloss({ text: "Hola", sourceLang: "es", nativeLang: "en", level: "A1" });
    expect(g.ok && g.value.tokens[0]).toMatchObject({ surface: "Hola", gloss: "hello" });

    const fb = await make(mockModel('{"ok":false,"better":"Quiero pan","note":"Use quiero"}').model).grammarFeedback({
      text: "Yo querer pan",
      nativeLang: "en",
      targetLang: "es",
      level: "A1",
    });
    expect(fb).toMatchObject({ ok: true, value: { ok: false, better: "Quiero pan" } });

    const c = await make(
      mockModel(JSON.stringify({ summary: "Likes bread.", facts: ["likes bread"], signals: { comprehension: 0.8, expression: 0.5, usedNativeLanguage: false, struggles: [] } })).model,
    ).compactConversation({ npcName: "Baker", playerName: "Lia", nativeLang: "en", targetLang: "es", memorySummary: "", turns: [{ speaker: "player", text: "Hola" }] });
    expect(c).toMatchObject({ ok: true, value: { summary: "Likes bread.", facts: ["likes bread"] } });

    const d = await make(mockModel('{"lang":"es"}').model).detectLanguage("¿Qué tal?");
    expect(d).toMatchObject({ ok: true, value: { lang: "es" } });
  });
});

describe("cache", () => {
  it("serves repeated lookups from memory without a model call", async () => {
    const { model } = mockModel(translation("Hello"));
    const ai = make(model, { cache: createContentCache(null) });
    await ai.translate({ text: "Hola", from: "es", to: "en" });
    const again = await ai.translate({ text: "Hola", from: "es", to: "en" });
    expect(again).toEqual({ ok: true, value: { translation: "Hello" }, source: "cache" });
    expect(model).toHaveBeenCalledTimes(1);
    // Another target language is another entry.
    await ai.translate({ text: "Hola", from: "es", to: "fr" });
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("persists glosses and translations to the player's store (a new session hits it)", async () => {
    const store = memoryStore();
    const first = mockModel(translation("Hello"));
    await make(first.model, { cache: createContentCache(store) }).translate({ text: "Hola", from: "es", to: "en" });
    expect(store.data.size).toBe(1);
    expect([...store.data.keys()][0]).toMatch(/^[0-9a-f]{64}$/);
    const second = mockModel(translation("other"));
    const r = await make(second.model, { cache: createContentCache(store) }).translate({ text: "Hola", from: "es", to: "en" });
    expect(r).toMatchObject({ ok: true, source: "cache", value: { translation: "Hello" } });
    expect(second.model).not.toHaveBeenCalled();
  });

  it("keeps moderation in memory only and never caches compaction or failures", async () => {
    const store = memoryStore();
    const { model } = mockModel('{"ok":true}');
    const ai = make(model, { cache: createContentCache(store) });
    await ai.moderate({ text: "hi", side: "sender" });
    expect(store.data.size).toBe(0);
    await ai.moderate({ text: "hi", side: "sender" });
    expect(model).toHaveBeenCalledTimes(1);

    const failing = mockModel("bad");
    const ai2 = make(failing.model, { cache: createContentCache(store) });
    await ai2.translate({ text: "Hola", from: "es", to: "en" });
    await ai2.translate({ text: "Hola", from: "es", to: "en" });
    expect(failing.model).toHaveBeenCalledTimes(4);
    expect(store.data.size).toBe(0);
  });

  it("re-validates stored entries and ignores corrupt ones", async () => {
    const store = memoryStore();
    const seed = make(mockModel(translation("Hello")).model, { cache: createContentCache(store) });
    await seed.translate({ text: "Hola", from: "es", to: "en" });
    for (const k of store.data.keys()) store.data.set(k, { translation: 42 });
    const { model } = mockModel(translation("Fresh"));
    const r = await make(model, { cache: createContentCache(store) }).translate({ text: "Hola", from: "es", to: "en" });
    expect(r).toMatchObject({ ok: true, value: { translation: "Fresh" } });
  });

  it("shares one call between concurrent identical requests", async () => {
    const { model } = mockModel(translation("Hello"));
    const ai = make(model);
    const [a, b] = await Promise.all([ai.translate({ text: "Hola", from: "es", to: "en" }), ai.translate({ text: "Hola", from: "es", to: "en" })]);
    expect(a).toEqual(b);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe("chat adapters (M18 hooks)", () => {
  it("translate chat lines and report unavailability", async () => {
    const t = hybridTranslator(make(mockModel(translation("Hello")).model));
    expect(await t.translate({ messageId: "m1", text: "Hola", from: "es", to: "en" })).toEqual({ ok: true, text: "Hello", via: "on-device" });
    const off = hybridTranslator(make(mockModel(translation("x")).model, { cloudEnabled: false, onDeviceReady: () => false }));
    expect(await off.translate({ messageId: "m1", text: "Hola", from: "es", to: "en" })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("flag lines only on a valid 'not ok' verdict", async () => {
    const flagged = hybridModeration(make(mockModel('{"ok":false,"category":"personal_data"}').model));
    expect(await flagged.checkOutgoing("call me 555-1234", "en")).toEqual({ flagged: true, reason: "personal_data" });
    expect(await flagged.checkIncoming("call me 555-1234", "en")).toEqual({ flagged: true, reason: "personal_data" });
    const fine = hybridModeration(make(mockModel('{"ok":true}').model));
    expect(await fine.checkIncoming("hello", "en")).toEqual({ flagged: false });
    // No verdict (invalid answers, no model): the server blocklist only, so not flagged here.
    const broken = hybridModeration(make(mockModel("garbage").model));
    expect(await broken.checkOutgoing("hello", "en")).toEqual({ flagged: false });
    const offline = hybridModeration(make(mockModel('{"ok":false}').model, { onDeviceReady: () => false }));
    expect(await offline.checkIncoming("hello", "en")).toEqual({ flagged: false });
  });
});
