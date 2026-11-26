import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BARK_PAIRS, exchangeSeedMaterial, soloBarkSeedMaterial } from "../../packages/shared/src/index";
import { ambientPrompts, main, planAmbientSeed, sha256 } from "../../tools/seed/seed-ambient";

// The ambient barks seeding tool (build plan M31). Only the dry run and the prompts are exercised:
// nothing here talks to a Firebase project or the emulators.
afterEach(() => vi.restoreAllMocks());

const line = (text: string) => ({ text, translation: { en: text } });

describe("seed-ambient", () => {
  it("plans cache/lines/{hash} per solo line and per exchange line, and lists incomplete sets", async () => {
    const plan = planAmbientSeed({ lang: "es", solo: { baker: { work: [line("¡Pan fresco!")] } }, exchanges: { "farmer+mayor": [[line("¡Otra fiesta!"), line("¡Es importante!")]] } });
    expect(plan.docs).toHaveLength(3);
    const material = soloBarkSeedMaterial("baker", "work", "es", 0);
    const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(material))).toString("hex");
    expect(plan.docs[0]!.path).toBe(`cache/lines/${digest}`);
    expect(plan.docs[2]!.path).toBe(`cache/lines/${sha256(exchangeSeedMaterial("farmer", "mayor", "es", 0, 1))}`);
    expect(plan.missing).toContain("baker/work");
    expect(plan.missing).toContain("barista+librarian");
  });

  it("rejects unknown villagers, activities, pairs and languages", () => {
    expect(() => planAmbientSeed({ lang: "es", solo: { pirate: { work: [] } } })).toThrow(/unknown NPC/);
    expect(() => planAmbientSeed({ lang: "es", solo: { baker: { fish: [] } } })).toThrow(/no "fish"/);
    expect(() => planAmbientSeed({ lang: "es", exchanges: { "mayor+farmer": [] } })).toThrow(/relationship pair/);
    expect(() => planAmbientSeed({ lang: "xx" })).toThrow(/unknown language/);
  });

  it("prints a prompt per villager activity and per pair", async () => {
    const prompts = ambientPrompts("ja", "en");
    expect(prompts.filter((p) => p.key.includes("+"))).toHaveLength(BARK_PAIRS.length);
    expect(prompts.find((p) => p.key === "elder/fish")!.prompt).toContain("Japanese");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await main([])).toBe(2);
    expect(await main(["--prompts", "es"])).toBe(0);
  });
});
