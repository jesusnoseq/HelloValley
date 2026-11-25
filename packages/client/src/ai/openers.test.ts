import { describe, expect, it, vi } from "vitest";
import { BAKER_ES_A1_REPLY, npcContextFixture } from "../../../shared/src/npc/fixtures";
import { PROMPT_TEMPLATE_IDS } from "@hellovalley/shared";
import { createContentCache, type PersistentStore } from "./cache";
import { createOpeners } from "./openers";

const line = (text: string) => ({ ...BAKER_ES_A1_REPLY.lines[0]!, text, translation: text });
const SET = JSON.stringify({ openers: [line("¡Hola, {NAME}!"), line("¡Buenos días!"), line("¿Pan?"), line("¡Pasa, cariño!")] });

function memoryStore(): PersistentStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return { map, get: async (k) => map.get(k), set: async (k, v) => void map.set(k, v) };
}

describe("openers (cache per NPC × language × level, time and friendship band)", () => {
  it("generates a set once on a miss, keeps it in the player's own cache and fills the name", async () => {
    const store = memoryStore();
    const generate = vi.fn(async () => SET);
    const openers = createOpeners({ generate, cloudEnabled: true, cache: createContentCache(store), random: () => 0 });
    const ctx = npcContextFixture({ lang: "es", playerLevel: "A1" });
    const first = await openers.get(ctx, "Lia");
    expect(first).toMatchObject({ source: "generated", personalised: false, line: { text: "¡Hola, Lia!" } });
    expect(generate).toHaveBeenCalledWith({ templateId: PROMPT_TEMPLATE_IDS.npcOpener, variables: expect.objectContaining({ target: "Spanish", level: "A1", time_band: "morning", friendship_band: "new" }) });
    expect(store.map.size).toBe(1);

    // Same bands (another A-level, another morning minute): served from cache, no second call.
    const again = await createOpeners({ generate, cloudEnabled: true, cache: createContentCache(store), random: () => 0.6 }).get({ ...ctx, effectiveLevel: "A2" }, "Lia");
    expect(again).toMatchObject({ source: "cache", line: { text: "¿Pan?" } });
    expect(generate).toHaveBeenCalledTimes(1);

    // A different friendship band is a different set.
    await openers.get({ ...ctx, hearts: 6 }, "Lia");
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("prefers seeded openers, and returns null when nothing can be found or made", async () => {
    const seeded = vi.fn(async () => JSON.parse(SET));
    const generate = vi.fn(async () => "garbage");
    const ctx = npcContextFixture({ lang: "es", playerLevel: "A1" });
    expect(await createOpeners({ generate, cloudEnabled: true, seeded, random: () => 0.3 }).get(ctx, "Lia")).toMatchObject({ source: "seeded", line: { text: "¡Buenos días!" } });
    expect(generate).not.toHaveBeenCalled();
    expect(await createOpeners({ generate, cloudEnabled: true, warn: () => undefined }).get(ctx, "Lia")).toBeNull();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await createOpeners({ generate, cloudEnabled: false }).get(ctx, "Lia")).toBeNull();
  });

  it("personalises with the memory on-device, and keeps the cached opener when that fails", async () => {
    const ctx = { ...npcContextFixture({ lang: "es", playerLevel: "A1" }), memory: { summary: "Lia likes rye bread.", facts: [] } };
    const gloss = vi.fn(async () => ({ ok: true as const, source: "on-device" as const, value: { translation: "Rye bread again, Lia?", tokens: [{ surface: "¿Pan", gloss: "bread" }] } }));
    const personalise = vi.fn(async () => ({ ok: true as const, source: "on-device" as const, value: { text: "¿Pan de centeno otra vez, Lia?" } }));
    const result = await createOpeners({ generate: async () => SET, cloudEnabled: true, personalise, gloss, random: () => 0 }).get(ctx, "Lia");
    expect(result).toMatchObject({ personalised: true, line: { text: "¿Pan de centeno otra vez, Lia?", translation: "Rye bread again, Lia?" } });
    expect(personalise).toHaveBeenCalledWith(expect.objectContaining({ cachedOpener: "¡Hola, Lia!", memorySummary: "Lia likes rye bread." }));

    const failing = await createOpeners({
      generate: async () => SET,
      cloudEnabled: true,
      personalise,
      gloss: async () => ({ ok: false as const, reason: "failed" as const }),
      random: () => 0,
    }).get(ctx, "Lia");
    expect(failing).toMatchObject({ personalised: false, line: { text: "¡Hola, Lia!" } });
  });
});
