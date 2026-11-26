import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { noticeToCachedLine, QUEST_TEMPLATES, questNoticeSeedMaterial } from "../../packages/shared/src/index";
import { main, planQuestSeed, questPrompts, sha256 } from "../../tools/seed/seed-quests";

// The request notices seeding tool (build plan M30). Only the dry run and the prompts are
// exercised: nothing here talks to a Firebase project or the emulators.
afterEach(() => vi.restoreAllMocks());

const notice = noticeToCachedLine(
  { title: { text: "¡Aviso!", translation: "Notice!" }, body: [{ text: "La granjera necesita 3 huevos en la panadería antes de las 12:00.", translation: "The farmer needs 3 eggs at the bakery before 12:00." }] },
  "en",
);

describe("seed-quests", () => {
  it("plans cache/lines/{hash} per template at a level band and lists the templates the file lacks", async () => {
    const plan = planQuestSeed({ lang: "es", level: "A1", notices: { eggs_to_bakery: notice } });
    expect(plan.docs).toHaveLength(1);
    expect(plan.missing).toHaveLength(QUEST_TEMPLATES.length - 1);
    // The client looks the notice up by the same hash (Web Crypto sha256 of the same material).
    const material = questNoticeSeedMaterial("eggs_to_bakery", "es", "A1");
    const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(material))).toString("hex");
    expect(plan.docs[0]!.path).toBe(`cache/lines/${digest}`);
    expect(sha256(material)).toBe(digest);
  });

  it("rejects unknown templates, languages, levels and notices without a body", () => {
    expect(() => planQuestSeed({ lang: "es", level: "A1", notices: { free_hearts: notice } })).toThrow(/unknown request templates/);
    expect(() => planQuestSeed({ lang: "xx", level: "A1", notices: {} })).toThrow(/unknown language/);
    expect(() => planQuestSeed({ lang: "es", level: "A2", notices: {} })).toThrow();
    expect(() => planQuestSeed({ lang: "es", level: "A1", notices: { eggs_to_bakery: { text: "¡Aviso!" } } })).toThrow(/title and at least one body line/);
  });

  it("prints one prompt per template", () => {
    const prompts = questPrompts("ja", "B1", "en");
    expect(prompts).toHaveLength(QUEST_TEMPLATES.length);
    expect(prompts[0]!.prompt).toContain("Japanese at CEFR B1");
    expect(prompts.find((p) => p.templateId === "eggs_to_bakery")!.prompt).toContain('"deadline":"before 12:00"');
  });

  it("needs a file or --prompts with a band level", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await main([])).toBe(2);
    expect(await main(["--prompts", "es"])).toBe(2);
    expect(await main(["--prompts", "es", "A1", "en"])).toBe(0);
  });
});
