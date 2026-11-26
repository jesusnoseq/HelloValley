import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATE_IDS, resolveTemplateId, TEMPLATE_ID_PARAMS, TEMPLATE_ID_PREFIX } from "./dotprompt";

describe("template ids from Remote Config (build plan M38, architecture §3.2)", () => {
  it("uses a well-formed id of the same template", () => {
    expect(resolveTemplateId("npcTurn", "npc-turn-v1-2-0")).toBe("npc-turn-v1-2-0");
    expect(resolveTemplateId("npcOpener", " npc-opener-v2-0-10 ")).toBe("npc-opener-v2-0-10");
  });

  it("falls back to the bundled id for missing, malformed or foreign values", () => {
    for (const bad of [undefined, null, "", "npc-turn", "npc-turn-v1-0", "npc-turn-v1.0.0", "npc-opener-v1-0-0", "npc-turn-v1-0-0; drop", "npc-turn-v1-0-0-1", "npc-turn-v1000-0-0"]) {
      expect(resolveTemplateId("npcTurn", bad)).toBe(PROMPT_TEMPLATE_IDS.npcTurn);
    }
    expect(resolveTemplateId("npcOpener", "npc-turn-v9-0-0")).toBe(PROMPT_TEMPLATE_IDS.npcOpener);
  });

  it("keeps the defaults valid and the parameter names distinct", () => {
    for (const name of Object.keys(PROMPT_TEMPLATE_IDS) as (keyof typeof PROMPT_TEMPLATE_IDS)[]) {
      expect(resolveTemplateId(name, PROMPT_TEMPLATE_IDS[name])).toBe(PROMPT_TEMPLATE_IDS[name]);
      expect(PROMPT_TEMPLATE_IDS[name].startsWith(`${TEMPLATE_ID_PREFIX[name]}-v`)).toBe(true);
      expect(TEMPLATE_ID_PARAMS[name]).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expect(new Set(Object.values(TEMPLATE_ID_PARAMS)).size).toBe(Object.keys(TEMPLATE_ID_PARAMS).length);
  });
});
