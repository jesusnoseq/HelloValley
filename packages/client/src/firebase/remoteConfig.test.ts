import { describe, expect, it, vi } from "vitest";
import { PROMPT_TEMPLATE_IDS } from "@hellovalley/shared";
import { createTemplateIds } from "./remoteConfig";

/** Build plan M38: the active server prompt template ids come from Remote Config. */
describe("createTemplateIds", () => {
  it("uses the bundled ids without Remote Config (demo project)", async () => {
    const ids = createTemplateIds(null);
    await ids.ready;
    expect(ids.get("npcTurn")).toBe(PROMPT_TEMPLATE_IDS.npcTurn);
    expect(ids.get("npcOpener")).toBe(PROMPT_TEMPLATE_IDS.npcOpener);
  });

  it("switches to valid remote ids once they arrive, and ignores invalid ones", async () => {
    let resolve!: (v: Record<string, string | null>) => void;
    const load = vi.fn(() => new Promise<Record<string, string | null>>((r) => (resolve = r)));
    const ids = createTemplateIds(load);
    expect(load).toHaveBeenCalledWith(["npc_turn_template_id", "npc_opener_template_id"]);
    expect(ids.get("npcTurn")).toBe(PROMPT_TEMPLATE_IDS.npcTurn);
    resolve({ npc_turn_template_id: "npc-turn-v1-1-0", npc_opener_template_id: "oops" });
    await ids.ready;
    expect(ids.get("npcTurn")).toBe("npc-turn-v1-1-0");
    expect(ids.get("npcOpener")).toBe(PROMPT_TEMPLATE_IDS.npcOpener);
  });

  it("keeps the bundled ids when the fetch fails, and never rejects", async () => {
    const warn = vi.fn();
    const ids = createTemplateIds(() => Promise.reject(new Error("offline")), warn);
    await expect(ids.ready).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(ids.get("npcTurn")).toBe(PROMPT_TEMPLATE_IDS.npcTurn);
  });
});
