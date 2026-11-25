import { z } from "zod";
import type { PlaceId } from "../data/world";
import {
  ATTACHMENT_FITS,
  AttachmentModuleIdSchema,
  BuildingPropModuleIdSchema,
  ROOFS_WITH_DORMERS,
  RoofModuleIdSchema,
  SignIconSchema,
  type WallModuleId,
  WallModuleIdSchema,
} from "./modules";

/**
 * Style-agnostic building recipes (GDD §7.2), one JSON file per building in this folder.
 *
 * Frame: metres, Y up (glTF space, like the kit modules). The building's pivot is the front-left
 * corner of its footprint at ground level; the footprint covers x in [0, w] and z in [-d, 0], and
 * the front facade (the entrance) is the z = 0 plane facing +Z. The town layout (M11) places and
 * turns whole buildings.
 *
 * Facades: every footprint corner cell gets `corner.outer`. A side's slots are the cells between
 * its two corners (w - 2 on the front and back, d - 2 on the left and right), listed left to right
 * as seen from outside, one row per floor from the ground up. When a side lists fewer rows than
 * the building has floors, its last row repeats; a side with no rows uses `walls.default`.
 */

export const BUILDING_RECIPE_IDS = [
  "apartment_block",
  "bakery",
  "farm",
  "general_store",
  "clinic",
  "cafe",
  "gossip_house",
  "town_hall",
  "library",
  "elder_cottage",
] as const satisfies readonly PlaceId[];
export type BuildingRecipeId = (typeof BUILDING_RECIPE_IDS)[number];
export const BuildingRecipeIdSchema = z.enum(BUILDING_RECIPE_IDS);

export const FACADE_SIDES = ["front", "right", "back", "left"] as const;
export type FacadeSide = (typeof FACADE_SIDES)[number];
export const FacadeSideSchema = z.enum(FACADE_SIDES);

/** Footprint limits in cells: 3 wide so the front has a door slot between its corners. */
export const MIN_BUILDING_W = 3;
export const MIN_BUILDING_D = 2;
export const MAX_BUILDING_CELLS = 12;
export const MAX_BUILDING_FLOORS = 6;
/** Kit modules have three seeded variants (M05); a kit with fewer wraps the index. */
export const MAX_RECIPE_VARIANT = 2;

const VariantSchema = z.number().int().min(0).max(MAX_RECIPE_VARIANT);
const QuarterTurnSchema = z.number().int().min(0).max(3);
const FacadeRowsSchema = z.array(z.array(WallModuleIdSchema)).min(1);

export const RoofSpecSchema = z
  .object({
    module: RoofModuleIdSchema,
    /** The ridge runs along the footprint width (`x`) or depth (`z`). */
    ridge: z.enum(["x", "z"]),
    variant: VariantSchema.optional(),
    /** One chimney at the roof's `chimney` socket. */
    chimney: z.boolean().default(false),
    /** Dormers spread evenly along the ridge on the roof's front slope. */
    dormers: z.number().int().min(0).max(6).default(0),
  })
  .strict();

export const AttachmentSpecSchema = z
  .object({
    module: AttachmentModuleIdSchema,
    side: FacadeSideSchema,
    floor: z.number().int().min(0),
    /** Index into the side's slot row (0 = the first cell after the left corner). */
    slot: z.number().int().min(0),
    variant: VariantSchema.optional(),
    /** Shop icon drawn on a `sign.hanging` board. */
    icon: SignIconSchema.optional(),
  })
  .strict();

export const PropSpecSchema = z
  .object({
    module: BuildingPropModuleIdSchema,
    /** Pivot (the module's bottom-left-front corner) in the building frame, [x, z] metres. */
    at: z.tuple([z.number(), z.number()]),
    /** Quarter turns about +Y (counter-clockwise seen from above). */
    rot: QuarterTurnSchema.default(0),
    /** Copies in a row along the module's rotated +x (fence runs). */
    count: z.number().int().min(1).max(24).default(1),
    variant: VariantSchema.optional(),
  })
  .strict();

const WallsSchema = z
  .object({
    default: WallModuleIdSchema.default("wall.plain"),
    front: FacadeRowsSchema.optional(),
    right: FacadeRowsSchema.optional(),
    back: FacadeRowsSchema.optional(),
    left: FacadeRowsSchema.optional(),
  })
  .strict();

const RecipeObjectSchema = z
  .object({
    id: BuildingRecipeIdSchema,
    name: z.string().min(1),
    footprint: z
      .object({
        w: z.number().int().min(MIN_BUILDING_W).max(MAX_BUILDING_CELLS),
        d: z.number().int().min(MIN_BUILDING_D).max(MAX_BUILDING_CELLS),
      })
      .strict(),
    floors: z.number().int().min(1).max(MAX_BUILDING_FLOORS),
    /** Variant of every wall and corner, so the whole building shares one plaster swatch. */
    variant: VariantSchema.default(0),
    walls: WallsSchema.default({ default: "wall.plain" }),
    roof: RoofSpecSchema,
    attachments: z.array(AttachmentSpecSchema).default([]),
    props: z.array(PropSpecSchema).default([]),
  })
  .strict();

type RecipeObject = z.infer<typeof RecipeObjectSchema>;

/** Number of slots (non-corner cells) along a side. */
export function sideSlotCount(footprint: { w: number; d: number }, side: FacadeSide): number {
  return (side === "front" || side === "back" ? footprint.w : footprint.d) - 2;
}

/** The wall module of every slot of a side on one floor (rows repeat upwards, then the default). */
export function facadeRow(recipe: Pick<RecipeObject, "footprint" | "walls">, side: FacadeSide, floor: number): WallModuleId[] {
  const rows = recipe.walls[side];
  const n = sideSlotCount(recipe.footprint, side);
  if (!rows) return Array.from({ length: n }, () => recipe.walls.default);
  return [...(rows[Math.min(floor, rows.length - 1)] ?? [])];
}

/** The quarter-turned footprint of a prop row in the building frame: [x0, z0, x1, z1]. */
export function propRect(prop: { at: [number, number]; rot: number; count: number }, size: { w: number; d: number }): [number, number, number, number] {
  const w = size.w * prop.count;
  const d = size.d;
  // Local corners of the module box (x right, z towards -d at the back), turned by `rot`.
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [0, -d],
    [w, -d],
  ].map(([x, z]) => rotateXZ(x!, z!, prop.rot));
  const xs = corners.map((c) => c[0] + prop.at[0]);
  const zs = corners.map((c) => c[1] + prop.at[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/** Rotate (x, z) by quarter turns about +Y (three.js `rotateY` convention). */
export function rotateXZ(x: number, z: number, quarterTurns: number): [number, number] {
  switch (((quarterTurns % 4) + 4) % 4) {
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    case 3:
      return [-z, x];
    default:
      return [x, z];
  }
}

/** Footprints of the prop modules in cells (style kits share them; a test checks the manifest). */
export const PROP_FOOTPRINTS: Readonly<Record<z.infer<typeof BuildingPropModuleIdSchema>, { w: number; d: number }>> = {
  bench: { w: 2, d: 1 },
  lamp: { w: 1, d: 1 },
  fence: { w: 1, d: 1 },
  stair: { w: 1, d: 1 },
};

const EPS = 1e-6;

function checkRecipe(recipe: RecipeObject, ctx: z.RefinementCtx): void {
  const { footprint, floors } = recipe;
  for (const side of FACADE_SIDES) {
    const rows = recipe.walls[side];
    if (!rows) continue;
    const n = sideSlotCount(footprint, side);
    if (rows.length > floors) {
      ctx.addIssue({ code: "custom", path: ["walls", side], message: `${side} lists ${rows.length} rows for ${floors} floors` });
    }
    rows.forEach((row, floor) => {
      if (row.length !== n) {
        ctx.addIssue({
          code: "custom",
          path: ["walls", side, floor],
          message: `${side} floor ${floor} needs ${n} slots (the cells between the corners), got ${row.length}`,
        });
      }
    });
  }
  // Shopfronts only make sense at street level; an upper-floor door opens onto a balcony.
  for (const side of FACADE_SIDES) {
    for (let floor = 1; floor < floors; floor++) {
      facadeRow(recipe, side, floor).forEach((wall, slot) => {
        if (wall === "wall.shopfront") {
          ctx.addIssue({ code: "custom", path: ["walls", side], message: `${side} floor ${floor} slot ${slot}: shopfronts belong on the ground floor` });
        }
        const balcony = recipe.attachments.some((a) => a.module === "balcony" && a.side === side && a.floor === floor && a.slot === slot);
        if (wall === "wall.door" && !balcony) {
          ctx.addIssue({ code: "custom", path: ["walls", side], message: `${side} floor ${floor} slot ${slot}: an upper-floor door needs a balcony` });
        }
      });
    }
  }
  if (!facadeRow(recipe, "front", 0).includes("wall.door")) {
    ctx.addIssue({ code: "custom", path: ["walls", "front", 0], message: "the ground floor of the front needs a wall.door (the entrance)" });
  }

  const seen = new Set<string>();
  recipe.attachments.forEach((a, i) => {
    const path = ["attachments", i];
    if (a.floor >= floors) {
      ctx.addIssue({ code: "custom", path: [...path, "floor"], message: `floor ${a.floor} is above the top floor (${floors - 1})` });
      return;
    }
    const row = facadeRow(recipe, a.side, a.floor);
    const wall = row[a.slot];
    if (wall === undefined) {
      ctx.addIssue({ code: "custom", path: [...path, "slot"], message: `${a.side} has ${row.length} slots, not ${a.slot + 1}` });
      return;
    }
    if (!ATTACHMENT_FITS[a.module].includes(wall)) {
      ctx.addIssue({ code: "custom", path, message: `${a.module} does not fit ${wall} (fits ${ATTACHMENT_FITS[a.module].join(", ")})` });
    }
    if (a.icon && a.module !== "sign.hanging") {
      ctx.addIssue({ code: "custom", path: [...path, "icon"], message: "only sign.hanging carries an icon" });
    }
    const key = `${a.module}@${a.side}/${a.floor}/${a.slot}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path, message: `duplicate ${key}` });
    seen.add(key);
  });
  // An awning and a hanging sign on one wall cell would intersect.
  for (const a of recipe.attachments) {
    if (a.module !== "sign.hanging") continue;
    if (recipe.attachments.some((b) => b.module === "awning" && b.side === a.side && b.floor === a.floor && b.slot === a.slot)) {
      ctx.addIssue({ code: "custom", path: ["attachments"], message: `sign and awning share ${a.side}/${a.floor}/${a.slot}` });
    }
  }

  if (recipe.roof.dormers > 0) {
    if (!ROOFS_WITH_DORMERS.includes(recipe.roof.module)) {
      ctx.addIssue({ code: "custom", path: ["roof", "dormers"], message: `${recipe.roof.module} has no dormer slope` });
    }
    const ridgeLength = recipe.roof.ridge === "x" ? footprint.w : footprint.d;
    if (recipe.roof.dormers * 1.5 > ridgeLength) {
      ctx.addIssue({ code: "custom", path: ["roof", "dormers"], message: `${recipe.roof.dormers} dormers need ${recipe.roof.dormers * 1.5} m of ridge` });
    }
  }

  recipe.props.forEach((p, i) => {
    const [x0, z0, x1, z1] = propRect(p, PROP_FOOTPRINTS[p.module]);
    const overlaps = x0 < footprint.w - EPS && x1 > EPS && z0 < -EPS && z1 > -footprint.d + EPS;
    if (overlaps) ctx.addIssue({ code: "custom", path: ["props", i], message: `${p.module} stands inside the building footprint` });
  });
}

export const BuildingRecipeSchema = RecipeObjectSchema.superRefine(checkRecipe);

export type BuildingRecipe = z.infer<typeof BuildingRecipeSchema>;
export type BuildingRecipeInput = z.input<typeof BuildingRecipeSchema>;
export type RoofSpec = z.infer<typeof RoofSpecSchema>;
export type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;
export type PropSpec = z.infer<typeof PropSpecSchema>;

export function parseBuildingRecipe(data: unknown): BuildingRecipe {
  return BuildingRecipeSchema.parse(data);
}
