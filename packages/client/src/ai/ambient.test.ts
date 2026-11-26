import { describe, expect, it, vi } from "vitest";
import type { Room } from "@colyseus/sdk";
import { type AmbientBarksResponse, exchangeSeedMaterial, ServerMessage, soloBarkSeedMaterial, type PlayerProfile } from "@hellovalley/shared";
import type { TaskResult } from "./hybrid";
import { createAmbientBarks } from "./ambient";
import { attachNpcBarks, createNpcBarkStore, EXCHANGE_REPLY_MS } from "../net/npcBarks";
import { avatarStore } from "../state/avatarStore";

const generated: TaskResult<AmbientBarksResponse> & { ok: true } = {
  ok: true,
  source: "cache",
  value: {
    barks: [{ text: "¡Pan recién hecho!", translation: "Freshly baked bread!" }, { text: "Huele bien.", translation: "Smells good." }],
    exchanges: [{ first: { text: "Más trabajo, menos fiestas.", translation: "More work, fewer parties." }, second: { text: "¡Es un asunto importante!", translation: "It's an important matter!" } }],
  },
};

describe("ambient barks (build plan M31)", () => {
  it("uses the seeded lines first, then the player's own generated set", async () => {
    const generate = vi.fn(async (): Promise<TaskResult<AmbientBarksResponse>> => generated);
    const seeded = vi.fn(async (m: string) => (m === soloBarkSeedMaterial("baker", "work", "es", 0) ? { text: "¡Buenos días!", translation: { en: "Good morning!" } } : null));
    const barks = createAmbientBarks({ seeded, generate });
    expect(await barks.get({ bark: { kind: "solo", npcId: "baker", activity: "work", index: 0 }, targetLang: "es", nativeLang: "en" })).toEqual([{ text: "¡Buenos días!", translation: "Good morning!" }]);
    expect(generate).not.toHaveBeenCalled();
    // A miss: the generated set, picked by the server's index.
    expect(await barks.get({ bark: { kind: "solo", npcId: "baker", activity: "work", index: 3 }, targetLang: "es", nativeLang: "en" })).toEqual([generated.value.barks[1]]);
    expect(await barks.get({ bark: { kind: "exchange", a: "farmer", b: "mayor", index: 2 }, targetLang: "es", nativeLang: "en" })).toEqual([generated.value.exchanges[0]!.first, generated.value.exchanges[0]!.second]);
    expect(seeded).toHaveBeenCalledWith(exchangeSeedMaterial("farmer", "mayor", "es", 2, 0));
    // Nothing to show without a backend.
    const none = createAmbientBarks({ generate: async () => ({ ok: false, reason: "unavailable" }) });
    expect(await none.get({ bark: { kind: "solo", npcId: "baker", activity: "work", index: 0 }, targetLang: "es", nativeLang: "en" })).toBeNull();
  });

  it("shows a bark as bubbles in the player's target language, the reply a moment later", async () => {
    vi.useFakeTimers();
    try {
      avatarStore.setState({ profile: { targetLangs: ["es"], nativeLang: "en" } as unknown as PlayerProfile });
      const handlers = new Map<string, (m: unknown) => void>();
      const room = { onMessage: (type: string, fn: (m: unknown) => void) => (handlers.set(type, fn), () => handlers.delete(type)) } as unknown as Room;
      const store = createNpcBarkStore();
      const words = vi.fn(async () => [generated.value.exchanges[0]!.first, generated.value.exchanges[0]!.second]);
      const detach = attachNpcBarks(room, store, words);
      handlers.get(ServerMessage.NpcBark)!({ id: "b1", kind: "exchange", a: "farmer", b: "mayor", index: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(words).toHaveBeenCalledWith({ bark: { kind: "exchange", a: "farmer", b: "mayor", index: 0 }, targetLang: "es", nativeLang: "en" });
      expect(store.getState().bubbles.farmer?.line.text).toBe("Más trabajo, menos fiestas.");
      expect(store.getState().bubbles.mayor).toBeUndefined();
      await vi.advanceTimersByTimeAsync(EXCHANGE_REPLY_MS);
      expect(store.getState().bubbles.mayor?.line.text).toBe("¡Es un asunto importante!");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(store.getState().bubbles).toEqual({});
      handlers.get(ServerMessage.VillagePrivacy)!({ named: false });
      expect(store.getState().named).toBe(false);
      detach();
      expect(store.getState().named).toBeNull();
    } finally {
      vi.useRealTimers();
      avatarStore.setState({ profile: null });
    }
  });
});
