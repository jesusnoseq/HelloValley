import type { KitManifest, KitModule } from "./kit";

/**
 * Triangle budgets per kit module (GDD §7.2): a wall module is 150–600 triangles (corners
 * count as walls), hero props stay at or under 2k, and ground tiles, which repeat hundreds of
 * times, get a tighter cap. Mirrored by `budget_for` in tools/blender/hvmodules/europe/common.py.
 */
export const KIT_TRI_BUDGETS = {
  wall: { min: 150, max: 600 },
  tile: { min: 12, max: 400 },
  prop: { min: 12, max: 2000 },
} as const;

export type KitBudgetClass = keyof typeof KIT_TRI_BUDGETS;

/**
 * Building modules every style kit provides (build plan M05; M32–M34 reuse the same ids and
 * footprints so building recipes work in every style).
 */
export const KIT_BUILDING_MODULE_IDS = [
  "wall.plain",
  "wall.window",
  "wall.door",
  "wall.shopfront",
  "wall.timber",
  "corner.outer",
  "corner.inner",
  "roof.gable",
  "roof.hip",
  "roof.stepped_gable",
  "dormer",
  "chimney",
  "balcony",
  "awning",
  "flowerbox",
  "shutters",
  "sign.hanging",
  "stair",
  "fence",
  "lamp",
  "bench",
  "tile.cobble",
] as const;

export function kitBudgetClass(moduleId: string): KitBudgetClass {
  const family = moduleId.split(".", 1)[0];
  if (family === "wall" || family === "corner") return "wall";
  if (family === "tile") return "tile";
  return "prop";
}

export function kitTriBudget(moduleId: string): { min: number; max: number } {
  return KIT_TRI_BUDGETS[kitBudgetClass(moduleId)];
}

/** Every variant of a module whose triangle count is outside its budget. */
export function kitBudgetViolations(module: Pick<KitModule, "id" | "tris">): string[] {
  const { min, max } = kitTriBudget(module.id);
  return module.tris.flatMap((tris, variant) =>
    tris < min || tris > max ? [`${module.id} v${variant}: ${tris} tris outside ${min}-${max}`] : [],
  );
}

/** Problems that keep a manifest from being a complete style kit: missing building modules,
 * too few variants, and budget violations. Empty means the kit is complete. */
export function kitCompletenessProblems(manifest: Pick<KitManifest, "modules">, minVariants = 3): string[] {
  const byId = new Map(manifest.modules.map((m) => [m.id, m]));
  const problems: string[] = [];
  for (const id of KIT_BUILDING_MODULE_IDS) {
    const module = byId.get(id);
    if (!module) problems.push(`${id}: missing`);
    else if (module.variants < minVariants) problems.push(`${id}: ${module.variants} variants, expected ${minVariants}`);
  }
  for (const module of manifest.modules) problems.push(...kitBudgetViolations(module));
  return problems;
}
