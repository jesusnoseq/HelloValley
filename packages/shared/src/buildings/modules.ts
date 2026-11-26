import { z } from "zod";

/**
 * The semantic module ids a building recipe may use, grouped by the role the assembler gives
 * them (GDD §7.2). Every style kit provides all of them with the same footprint and sockets
 * (`KIT_BUILDING_MODULE_IDS`), so a recipe works in every style.
 */

/** One-storey wall modules for facade slots (1 cell wide, 3 m high, facade at the cell front). */
export const WALL_MODULE_IDS = ["wall.plain", "wall.window", "wall.door", "wall.shopfront", "wall.timber"] as const;
export type WallModuleId = (typeof WALL_MODULE_IDS)[number];
export const WallModuleIdSchema = z.enum(WALL_MODULE_IDS);

/** The convex corner the assembler puts in every footprint corner cell (an L of plain wall). */
export const CORNER_MODULE_ID = "corner.outer";

/** Complete 2 x 2-cell roofs; the assembler scales them to the footprint. */
export const ROOF_MODULE_IDS = ["roof.gable", "roof.hip", "roof.stepped_gable"] as const;
export type RoofModuleId = (typeof ROOF_MODULE_IDS)[number];
export const RoofModuleIdSchema = z.enum(ROOF_MODULE_IDS);

export const CHIMNEY_MODULE_ID = "chimney";
export const DORMER_MODULE_ID = "dormer";

/** Roofs with a `dormer` socket (a slope facing the roof's front). Hip roofs have none. */
export const ROOFS_WITH_DORMERS: readonly RoofModuleId[] = ["roof.gable", "roof.stepped_gable"];

/** Attachments occupy the cell in front of a wall, in that wall's storey frame. */
export const ATTACHMENT_MODULE_IDS = ["balcony", "awning", "flowerbox", "shutters", "sign.hanging"] as const;
export type AttachmentModuleId = (typeof ATTACHMENT_MODULE_IDS)[number];
export const AttachmentModuleIdSchema = z.enum(ATTACHMENT_MODULE_IDS);

/**
 * The walls each attachment is sized for: the `fits:<wall>` tags of the kit manifest (M05).
 * A test keeps this table equal to the committed europe manifest.
 */
export const ATTACHMENT_FITS: Readonly<Record<AttachmentModuleId, readonly WallModuleId[]>> = {
  balcony: ["wall.door", "wall.window"],
  awning: ["wall.shopfront", "wall.door"],
  flowerbox: ["wall.window"],
  shutters: ["wall.window"],
  "sign.hanging": ["wall.plain", "wall.door", "wall.shopfront", "wall.timber"],
};

/** Free-standing style-kit pieces a recipe can put around its building. */
export const BUILDING_PROP_MODULE_IDS = ["bench", "lamp", "fence", "stair"] as const;
export type BuildingPropModuleId = (typeof BUILDING_PROP_MODULE_IDS)[number];
export const BuildingPropModuleIdSchema = z.enum(BUILDING_PROP_MODULE_IDS);

/** Every module id a recipe can make the assembler place. */
export const RECIPE_MODULE_IDS = [
  ...WALL_MODULE_IDS,
  CORNER_MODULE_ID,
  ...ROOF_MODULE_IDS,
  CHIMNEY_MODULE_ID,
  DORMER_MODULE_ID,
  ...ATTACHMENT_MODULE_IDS,
  ...BUILDING_PROP_MODULE_IDS,
] as const;
export type RecipeModuleId = (typeof RECIPE_MODULE_IDS)[number];

/**
 * Shop icons for `sign.hanging` boards. The client draws them at the sign's `icon` sockets; the
 * hand-drawn icon set is TODO(backlog).
 */
export const SIGN_ICONS = ["bread", "wheat", "basket", "cross", "coffee", "heart", "scroll", "book", "teapot", "home"] as const;
export type SignIcon = (typeof SIGN_ICONS)[number];
export const SignIconSchema = z.enum(SIGN_ICONS);
