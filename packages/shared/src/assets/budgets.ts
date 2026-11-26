import type { StyleId } from "../data/styles";
import type { KitManifest, KitModule } from "./kit";

/**
 * Triangle budgets per kit module (GDD §7.2): a wall module is 150–600 triangles (corners
 * count as walls, and so do interior wall panels, `iwall.*`), hero props and furniture stay at or
 * under 2k, and ground and floor tiles (`tile.*`, `terrain.*`, `floor.*`),
 * which repeat hundreds of times, get a tighter cap, as do instanced plants (trees, bushes,
 * flowers, climbers). Mirrored by tools/blender/hvkit/budgets.py.
 */
export const KIT_TRI_BUDGETS = {
  wall: { min: 150, max: 600 },
  tile: { min: 12, max: 400 },
  plant: { min: 12, max: 1000 },
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

/**
 * Style-only modules a style kit adds next to the building modules (props and plants with no
 * counterpart in the other styles, so building recipes never use them). Mediterranean (M32):
 * a pergola, a bougainvillea climber, terracotta pots and the lemon tree; olive and cypress
 * trees are in the common kit. Mirrored by `MED_EXTRA_IDS` in
 * tools/blender/hvmodules/mediterranean/plants.py. Arabic (M33): an arcade section, a courtyard
 * fountain (the common fountain's footprint and sockets), a standing brass lantern and the date
 * palm; mirrored by `ARAB_EXTRA_IDS` in tools/blender/hvmodules/arabic/extras.py.
 */
export const KIT_STYLE_EXTRA_MODULE_IDS = {
  european: [],
  mediterranean: ["pergola", "bougainvillea", "pot.terracotta", "tree.lemon"],
  arabic: ["arcade", "fountain.courtyard", "lantern.brass", "tree.date_palm"],
  japanese: [],
} as const satisfies Record<StyleId, readonly string[]>;

/** Every module a complete style kit ships: the building modules plus its style-only extras. */
export function styleKitModuleIds(style: StyleId): readonly string[] {
  return [...KIT_BUILDING_MODULE_IDS, ...KIT_STYLE_EXTRA_MODULE_IDS[style]];
}

/**
 * Style-neutral modules of the common kit (build plan M06). Terrain edges and river banks
 * follow the marching-squares convention in tools/blender/hvmodules/common/base.py.
 */
export const KIT_COMMON_MODULE_IDS = [
  "terrain.grass",
  "terrain.path",
  "terrain.cobble",
  "terrain.sand",
  "terrain.path.edge",
  "terrain.path.outer",
  "terrain.path.inner",
  "terrain.cobble.edge",
  "terrain.cobble.outer",
  "terrain.cobble.inner",
  "terrain.sand.edge",
  "terrain.sand.outer",
  "terrain.sand.inner",
  "bank.straight",
  "bank.outer",
  "bank.inner",
  "bank.curve_outer",
  "bank.curve_inner",
  "bank.water",
  "bridge.stone",
  "dock.fishing",
  "fountain",
  "tree.deciduous",
  "tree.conifer",
  "tree.cypress",
  "tree.palm",
  "tree.sakura",
  "tree.olive",
  "bush",
  "flowers",
  "rock",
  "crate",
  "barrel",
  "basket",
  "notice_board",
  "market_stall",
] as const;

/**
 * Modules of the interior kit (build plan M08): room floor and wall panels on the 1 m grid,
 * apartment furniture and shop interiors. Every module except the `floor.*` and `iwall.*`
 * panels is furniture and declares a `placement` footprint on the 0.5 m grid.
 */
export const KIT_INTERIOR_MODULE_IDS = [
  "floor.wood",
  "floor.tile",
  "floor.stone",
  "iwall.plain",
  "iwall.window",
  "iwall.door",
  "bed",
  "table",
  "chair",
  "sofa",
  "wardrobe",
  "mirror",
  "kitchen.nook",
  "shelf",
  "plant.potted",
  "rug",
  "lamp.floor",
  "lamp.table",
  "painting",
  "bakery.counter",
  "bakery.oven",
  "store.shelf",
  "cafe.bar",
  "clinic.desk",
  "library.shelf",
  "townhall.desk",
  "barn.stall",
  "barn.hay",
] as const;

/** Interior room panels (floors and walls on the 1 m building grid); the rest of the interior
 * kit is furniture. */
export function isRoomPanelModuleId(moduleId: string): boolean {
  return moduleId.startsWith("floor.") || moduleId.startsWith("iwall.");
}

/** Tree modules: each variant has a trunk mesh plus a separate canopy mesh and material. */
export function isTreeModuleId(moduleId: string): boolean {
  return moduleId.startsWith("tree.");
}

const FAMILY_CLASS: Record<string, KitBudgetClass> = {
  wall: "wall",
  corner: "wall",
  tile: "tile",
  terrain: "tile",
  floor: "tile",
  iwall: "wall",
  tree: "plant",
  bush: "plant",
  flowers: "plant",
  bougainvillea: "plant",
};

export function kitBudgetClass(moduleId: string): KitBudgetClass {
  return FAMILY_CLASS[moduleId.split(".", 1)[0] ?? ""] ?? "prop";
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

/** Problems that keep a manifest from being a complete kit: missing modules (the building
 * modules of a style kit by default, or `KIT_COMMON_MODULE_IDS` for the common kit), too few
 * variants, and budget violations. Empty means the kit is complete. */
export function kitCompletenessProblems(
  manifest: Pick<KitManifest, "modules">,
  minVariants = 3,
  requiredIds: readonly string[] = KIT_BUILDING_MODULE_IDS,
): string[] {
  const byId = new Map(manifest.modules.map((m) => [m.id, m]));
  const problems: string[] = [];
  for (const id of requiredIds) {
    const module = byId.get(id);
    if (!module) problems.push(`${id}: missing`);
    else if (module.variants < minVariants) problems.push(`${id}: ${module.variants} variants, expected ${minVariants}`);
  }
  for (const module of manifest.modules) problems.push(...kitBudgetViolations(module));
  return problems;
}
