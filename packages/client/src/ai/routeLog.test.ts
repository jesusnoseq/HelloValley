import { describe, expect, it, vi } from "vitest";
import { createContentCache } from "./cache";
import { createHybridAI, type ModelPort, type RouteEvent } from "./hybrid";
import { formatRoute, ROUTE_LOG_KEY, routeLogEnabled } from "./routeLog";

/** Build plan M38: the demo's on-device vs cloud log. */
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe("routeLogEnabled", () => {
  it("is off by default, on with ?ailog (remembered for the session) or the localStorage flag", () => {
    expect(routeLogEnabled("", memory(), memory())).toBe(false);
    const session = memory();
    expect(routeLogEnabled("?ailog", session, null)).toBe(true);
    expect(routeLogEnabled("", session, null)).toBe(true);
    const local = memory();
    local.setItem(ROUTE_LOG_KEY, "1");
    expect(routeLogEnabled("", null, local)).toBe(true);
  });

  it("survives storage that throws (private mode)", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(routeLogEnabled("", broken, broken)).toBe(false);
  });
});

describe("the hybrid route events", () => {
  it("report the source of each task call, the cache, and fallbacks", async () => {
    const events: RouteEvent[] = [];
    const model: ModelPort = vi.fn(async () => ({ text: JSON.stringify({ translation: "Hello" }), source: "on-device" as const }));
    const ai = createHybridAI({ model, onDeviceReady: () => true, cloudEnabled: true, warn: () => {}, onRoute: (e) => events.push(e), cache: createContentCache(null) });
    await ai.translate({ text: "Hola", from: "es", to: "en" });
    await ai.translate({ text: "Hola", from: "es", to: "en" });
    const offline = createHybridAI({ model, onDeviceReady: () => false, cloudEnabled: false, warn: () => {}, onRoute: (e) => events.push(e) });
    await offline.grammarFeedback({ text: "Yo quiero pan", targetLang: "es", nativeLang: "en", level: "A1" } as never);
    expect(events.map((e) => [e.task, e.source])).toEqual([
      ["translateShort", "on-device"],
      ["translateShort", "cache"],
      ["grammarFeedback", "fallback"],
    ]);
    expect(formatRoute(events[0]!)).toMatch(/^\[ai\] translateShort → on-device \(\d+ ms\)$/);
    expect(formatRoute({ task: "npcTurn", source: "cloud", detail: "template npc-turn-v1-0-0" })).toBe("[ai] npcTurn → cloud (template npc-turn-v1-0-0)");
  });
});
