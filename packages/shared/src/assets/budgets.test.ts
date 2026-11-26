import { describe, expect, it } from "vitest";
import {
  isRoomPanelModuleId,
  isTreeModuleId,
  KIT_BUILDING_MODULE_IDS,
  KIT_COMMON_MODULE_IDS,
  KIT_INTERIOR_MODULE_IDS,
  kitBudgetClass,
  kitBudgetViolations,
  kitCompletenessProblems,
  kitTriBudget,
  KIT_STYLE_EXTRA_MODULE_IDS,
  styleKitModuleIds,
} from "./budgets";
import { COMMON_KIT_ID, INTERIOR_KIT_ID, KIT_IDS, KitIdSchema, ModuleIdSchema } from "./kit";

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
    expect(kitBudgetClass("terrain.path.edge")).toBe("tile");
    expect(kitBudgetClass("tree.palm")).toBe("plant");
    expect(kitBudgetClass("bush")).toBe("plant");
    expect(kitBudgetClass("flowers")).toBe("plant");
    expect(kitBudgetClass("bank.curve_outer")).toBe("prop");
    expect(kitBudgetClass("market_stall")).toBe("prop");
    expect(kitTriBudget("tree.deciduous").max).toBe(1000);
  });

  it("lists style-only extras that collide with no other kit", () => {
    expect(kitBudgetClass("bougainvillea")).toBe("plant");
    expect(kitBudgetClass("tree.lemon")).toBe("plant");
    expect(kitBudgetClass("pot.terracotta")).toBe("prop");
    expect(KIT_STYLE_EXTRA_MODULE_IDS.european).toEqual([]);
    const med = styleKitModuleIds("mediterranean");
    expect(med.slice(0, KIT_BUILDING_MODULE_IDS.length)).toEqual([...KIT_BUILDING_MODULE_IDS]);
    expect(med).toContain("pergola");
    for (const id of KIT_STYLE_EXTRA_MODULE_IDS.mediterranean) {
      expect(ModuleIdSchema.safeParse(id).success).toBe(true);
      expect(KIT_BUILDING_MODULE_IDS as readonly string[]).not.toContain(id);
      expect(KIT_COMMON_MODULE_IDS as readonly string[]).not.toContain(id);
      expect(KIT_INTERIOR_MODULE_IDS as readonly string[]).not.toContain(id);
    }
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

describe("common kit", () => {
  it("is a kit id next to the four styles", () => {
    expect(KIT_IDS).toEqual(["european", "mediterranean", "arabic", "japanese", "common", "interior"]);
    expect(KitIdSchema.parse(COMMON_KIT_ID)).toBe("common");
    expect(KitIdSchema.safeParse("europe").success).toBe(false);
  });

  it("lists the M06 modules with valid, unique ids", () => {
    expect(new Set(KIT_COMMON_MODULE_IDS).size).toBe(KIT_COMMON_MODULE_IDS.length);
    for (const id of KIT_COMMON_MODULE_IDS) expect(ModuleIdSchema.safeParse(id).success).toBe(true);
    expect(KIT_COMMON_MODULE_IDS.filter(isTreeModuleId)).toEqual([
      "tree.deciduous",
      "tree.conifer",
      "tree.cypress",
      "tree.palm",
      "tree.sakura",
      "tree.olive",
    ]);
    expect(KIT_COMMON_MODULE_IDS.some((id) => (KIT_BUILDING_MODULE_IDS as readonly string[]).includes(id))).toBe(false);
  });

  it("checks completeness against the common ids", () => {
    const modules = KIT_COMMON_MODULE_IDS.map((id) => ({ id, variants: 3, tris: [100, 100, 100] }));
    expect(kitCompletenessProblems({ modules: modules as never }, 3, KIT_COMMON_MODULE_IDS)).toEqual([]);
    expect(kitCompletenessProblems({ modules: modules.slice(1) as never }, 3, KIT_COMMON_MODULE_IDS)).toEqual([
      "terrain.grass: missing",
    ]);
  });
});

describe("interior kit", () => {
  it("is a kit id", () => {
    expect(KitIdSchema.parse(INTERIOR_KIT_ID)).toBe("interior");
  });

  it("lists the M08 modules with valid, unique ids that no other kit uses", () => {
    expect(new Set(KIT_INTERIOR_MODULE_IDS).size).toBe(KIT_INTERIOR_MODULE_IDS.length);
    for (const id of KIT_INTERIOR_MODULE_IDS) expect(ModuleIdSchema.safeParse(id).success).toBe(true);
    const others = new Set<string>([...KIT_BUILDING_MODULE_IDS, ...KIT_COMMON_MODULE_IDS]);
    expect(KIT_INTERIOR_MODULE_IDS.filter((id) => others.has(id))).toEqual([]);
    expect(KIT_INTERIOR_MODULE_IDS.filter(isRoomPanelModuleId)).toEqual([
      "floor.wood",
      "floor.tile",
      "floor.stone",
      "iwall.plain",
      "iwall.window",
      "iwall.door",
    ]);
  });

  it("budgets floors as tiles, wall panels as walls and furniture as props", () => {
    expect(kitBudgetClass("floor.wood")).toBe("tile");
    expect(kitBudgetClass("iwall.window")).toBe("wall");
    expect(kitTriBudget("iwall.door")).toEqual({ min: 150, max: 600 });
    expect(kitBudgetClass("bakery.oven")).toBe("prop");
    expect(kitBudgetClass("plant.potted")).toBe("prop");
  });
});
