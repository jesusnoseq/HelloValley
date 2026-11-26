import { afterEach, describe, expect, it, vi } from "vitest";
import { LABEL_KEYS, WORLD_LABELS_BATCH } from "../../packages/shared/src/index";
import { labelPrompts, main, planLabelsSeed } from "../../tools/seed/seed-labels";

// The world-labels seeding tool (build plan M25). Only the dry run and the prompts are exercised:
// nothing here talks to a Firebase project or the emulators.
afterEach(() => vi.restoreAllMocks());

describe("seed-labels", () => {
  it("plans cache/labels/{lang} and lists the keys the file lacks", () => {
    const plan = planLabelsSeed({ lang: "es", labels: { "item.bread": { word: "pan" }, "prop.bench": { word: "banco" } } });
    expect(plan.docPath).toBe("cache/labels/es");
    expect(plan.doc["item.bread"]).toEqual({ word: "pan" });
    expect(plan.missing).toHaveLength(LABEL_KEYS.length - 2);
  });

  it("rejects unknown keys, languages and bad shapes", () => {
    expect(() => planLabelsSeed({ lang: "es", labels: { "item.dragon": { word: "dragón" } } })).toThrow(/unknown label keys/);
    expect(() => planLabelsSeed({ lang: "xx", labels: {} })).toThrow(/unknown language/);
    expect(() => planLabelsSeed({ lang: "es", labels: { "item.bread": { word: "" } } })).toThrow();
  });

  it("prints one prompt per batch covering every key", () => {
    const prompts = labelPrompts("ja");
    expect(prompts).toHaveLength(Math.ceil(LABEL_KEYS.length / WORLD_LABELS_BATCH));
    for (const key of LABEL_KEYS) expect(prompts.some((p) => p.includes(`"key":"${key}"`))).toBe(true);
  });

  it("needs a file or --prompts, and --write needs a project", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await main([])).toBe(2);
    expect(await main(["--prompts", "es"])).toBe(0);
  });
});
