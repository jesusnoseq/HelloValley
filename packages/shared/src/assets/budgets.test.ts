import { describe, expect, it } from "vitest";
import {
  KIT_BUILDING_MODULE_IDS,
  kitBudgetClass,
  kitBudgetViolations,
  kitCompletenessProblems,
  kitTriBudget,
} from "./budgets";
import { ModuleIdSchema } from "./kit";

describe("kit triangle budgets", () => {
  it("follows GDD §7.2", () => {
    expect(kitTriBudget("wall.plain")).toEqual({ min: 150, max: 600 });
    expect(kitTriBudget("corner.outer")).toEqual({ min: 150, max: 600 });
    expect(kitTriBudget("lamp").max).toBe(2000);
    expect(kitTriBudget("roof.gable").max).toBe(2000);
    expect(kitTriBudget("tile.cobble").max).toBeLessThan(2000);
  });

  it("classifies by the id family", () => {
    expect(kitBudgetClass("wall.timber")).toBe("wall");
    expect(kitBudgetClass("tile.cobble")).toBe("tile");
    expect(kitBudgetClass("sign.hanging")).toBe("prop");
    expect(kitBudgetClass("dormer")).toBe("prop");
  });

  it("reports variants outside the budget", () => {
    expect(kitBudgetViolations({ id: "wall.plain", tris: [150, 600, 300] })).toEqual([]);
    expect(kitBudgetViolations({ id: "wall.plain", tris: [149, 601, 300] })).toEqual([
      "wall.plain v0: 149 tris outside 150-600",
      "wall.plain v1: 601 tris outside 150-600",
    ]);
    expect(kitBudgetViolations({ id: "bench", tris: [2001] })).toHaveLength(1);
  });
});

describe("kit completeness", () => {
  const complete = KIT_BUILDING_MODULE_IDS.map((id) => ({ id, variants: 3, tris: [200, 200, 200] }));

  it("lists the 22 building modules with valid ids", () => {
    expect(KIT_BUILDING_MODULE_IDS).toHaveLength(22);
    expect(new Set(KIT_BUILDING_MODULE_IDS).size).toBe(22);
    for (const id of KIT_BUILDING_MODULE_IDS) expect(ModuleIdSchema.safeParse(id).success).toBe(true);
  });

  it("accepts a complete kit and names what is missing or off budget", () => {
    expect(kitCompletenessProblems({ modules: complete as never })).toEqual([]);
    const broken = complete
      .filter((m) => m.id !== "dormer")
      .map((m) => (m.id === "lamp" ? { ...m, variants: 2, tris: [3000, 10] } : m));
    expect(kitCompletenessProblems({ modules: broken as never })).toEqual([
      "dormer: missing",
      "lamp: 2 variants, expected 3",
      "lamp v0: 3000 tris outside 12-2000",
      "lamp v1: 10 tris outside 12-2000",
    ]);
  });
});
