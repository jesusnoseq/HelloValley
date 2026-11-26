import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { elderBarkSeedMaterial, FISH } from "../../packages/shared/src/index";
import { barkPrompts, main, planBarksSeed, sha256 } from "../../tools/seed/seed-barks";

// The Elder's catch comments seeding tool (build plan M27). Only the dry run and the prompts are
// exercised: nothing here talks to a Firebase project or the emulators.
afterEach(() => vi.restoreAllMocks());

describe("seed-barks", () => {
  it("plans cache/lines/{hash} per fish and lists the species the file lacks", async () => {
    const plan = planBarksSeed({ lang: "es", barks: { carp: { text: "¡Una carpa! Paciencia y pesca.", translation: { en: "A carp! Patience and fishing." } } } });
    expect(plan.docs).toHaveLength(1);
    expect(plan.missing).toHaveLength(FISH.length - 1);
    // The client looks the line up by the same hash (Web Crypto sha256 of the same material).
    const material = elderBarkSeedMaterial("carp", "es");
    const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(material))).toString("hex");
    expect(plan.docs[0]!.path).toBe(`cache/lines/${digest}`);
    expect(sha256(material)).toBe(digest);
  });

  it("rejects unknown fish, languages and bad shapes", () => {
    expect(() => planBarksSeed({ lang: "es", barks: { shark: { text: "¡Un tiburón!" } } })).toThrow(/unknown fish/);
    expect(() => planBarksSeed({ lang: "xx", barks: {} })).toThrow(/unknown language/);
    expect(() => planBarksSeed({ lang: "es", barks: { carp: { text: "" } } })).toThrow();
  });

  it("prints one prompt per species", () => {
    const prompts = barkPrompts("ja", "en");
    expect(prompts).toHaveLength(FISH.length);
    expect(prompts[0]!.prompt).toContain("Japanese");
    expect(prompts.find((p) => p.fishId === "ghost_pike")!.prompt).toContain("ghost pike (legendary)");
  });

  it("needs a file or --prompts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await main([])).toBe(2);
    expect(await main(["--prompts", "es", "en"])).toBe(0);
  });
});
