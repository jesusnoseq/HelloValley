import { z } from "zod";
import { STYLE_IDS } from "../data/styles";

/**
 * Kit grid (GDD §7.2): 1 m cells, 3 m storeys. Modules pivot at their bottom-left-front
 * corner. Keep in sync with tools/blender/hvkit/grid.py (a Python test checks this).
 */
export const CELL_M = 1;
export const STOREY_M = 3;

/** kit-manifest.json format version; matches MANIFEST_VERSION in tools/blender/hvkit/manifest.py. */
export const KIT_MANIFEST_VERSION = 1;
export const KIT_MANIFEST_FILE = "kit-manifest.json";

/**
 * The style-neutral kit (M06: terrain, river pieces, bridge, dock, fountain, vegetation and
 * generic props) in `kits/common/`. The client loads it next to the player's style kit.
 * Mirrors COMMON_KIT_ID in tools/blender/hvkit/styles.py.
 */
export const COMMON_KIT_ID = "common";
/**
 * The interior and furniture kit (M08: room floor and wall panels, apartment furniture and
 * shop interiors) in `kits/interior/`. Loaded by interior scenes (client scene/Interior.tsx, room
 * layouts in shared world/interiors.ts) and the apartment
 * (TODO(M17)). Mirrors INTERIOR_KIT_ID in tools/blender/hvkit/styles.py.
 */
export const INTERIOR_KIT_ID = "interior";
/** Every kit folder: one per town style plus the common and interior kits. */
export const KIT_IDS = [...STYLE_IDS, COMMON_KIT_ID, INTERIOR_KIT_ID] as const;
export type KitId = (typeof KIT_IDS)[number];
export const KitIdSchema = z.enum(KIT_IDS);

/** Material extras the generator writes (three.js `material.userData`). `hv_atlas` materials
 * sample the kit atlas; `hv_canopy` marks the wind-swayed canopy slot (also atlas); `hv_water`
 * is a river or fountain surface the client shades itself. */
export const KIT_MATERIAL_MARKERS = ["hv_atlas", "hv_canopy", "hv_glass", "hv_glow", "hv_water"] as const;

/** `hv_part` node extras of a tree or plant canopy mesh: its own mesh and material slot, with
 * the object origin at the top of the trunk (the sway pivot). */
export const KIT_CANOPY_PART = "canopy";
/** Manifest tag of modules that have a canopy mesh. */
export const KIT_CANOPY_TAG = "canopy";

/** Dotted lowercase semantic ids such as `wall.plain` or `roof.stepped_gable`. */
export const ModuleIdSchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/);

const FileNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/);
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const UvRectSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([u0, v0, u1, v1]) => u0 < u1 && v0 < v1, "an atlas rect needs u0 < u1 and v0 < v1");

/**
 * Furniture placement grid (GDD §4.2): furniture snaps to 0.5 m cells and turns in quarter
 * turns. Keep in sync with PLACEMENT_CELL_M in tools/blender/hvkit/grid.py.
 */
export const PLACEMENT_CELL_M = 0.5;

/**
 * How a furniture piece is placed. `floor`: stands on the floor and blocks its cells. `rug`:
 * lies flat on the floor; players walk over it and floor pieces may stand on it. `wall`: hangs
 * on a wall (its back edge is the wall) and leaves the floor free. `surface`: stands on another
 * piece's `top` socket (a lamp on a table).
 */
export const PLACEMENT_MOUNTS = ["floor", "rug", "wall", "surface"] as const;
export type PlacementMount = (typeof PLACEMENT_MOUNTS)[number];

/**
 * The placement footprint of a furniture piece, in `cell`-metre cells (`w` along x, `d` along the
 * depth) in the module frame: the piece covers x in [0, w * cell] and z in [-d * cell, 0], with
 * its front at z = 0 and its back edge at z = -d * cell. `againstWall` pieces (wardrobes, beds,
 * shelves, stoves) must have that back edge on a wall.
 */
export const KitPlacementSchema = z.object({
  cell: z.literal(PLACEMENT_CELL_M),
  w: z.number().int().min(1),
  d: z.number().int().min(1),
  mount: z.enum(PLACEMENT_MOUNTS),
  againstWall: z.boolean(),
});

export const SOCKET_KINDS = ["stack", "attach", "edge", "prop"] as const;

/** All positions are glTF space: metres, Y up, the module front at z = 0 facing +Z. */
export const KitSocketSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  kind: z.enum(SOCKET_KINDS),
  pos: Vec3Schema,
  normal: Vec3Schema,
});

export const KitModuleSchema = z
  .object({
    id: ModuleIdSchema,
    file: FileNameSchema.refine((f) => f.endsWith(".glb"), "module files are .glb"),
    footprint: z.object({
      w: z.number().int().min(1),
      d: z.number().int().min(1),
      /** Nominal height in metres. */
      h: z.number().min(0),
    }),
    variants: z.number().int().min(1),
    bounds: z.object({ min: Vec3Schema, max: Vec3Schema }),
    sockets: z.array(KitSocketSchema),
    /** Triangles per variant. */
    tris: z.array(z.number().int().min(0)),
    tags: z.array(z.string()).default([]),
    /** Furniture only (the interior kit): the footprint on the 0.5 m placement grid. */
    placement: KitPlacementSchema.optional(),
  })
  .refine((m) => m.tris.length === m.variants, { message: "tris needs one count per variant", path: ["tris"] })
  .refine((m) => m.bounds.min.every((lo, i) => lo <= (m.bounds.max[i] ?? lo)), {
    message: "bounds min must not exceed max",
    path: ["bounds"],
  })
  .refine((m) => new Set(m.sockets.map((s) => s.name)).size === m.sockets.length, {
    message: "socket names must be unique",
    path: ["sockets"],
  })
  .refine(
    (m) => !m.placement || (m.placement.w * m.placement.cell <= m.footprint.w * CELL_M && m.placement.d * m.placement.cell <= m.footprint.d * CELL_M),
    { message: "the placement footprint must fit inside the module footprint", path: ["placement"] },
  );

export const KitAtlasSchema = z.object({
  /** Shared texture for every module of the kit: png from Blender, ktx2/webp after optimizing. */
  file: FileNameSchema.refine((f) => /\.(png|webp|ktx2)$/.test(f), "atlas must be png, webp or ktx2"),
  size: z.number().int().positive(),
  /** glTF-space UV rect [u0, v0, u1, v1] of each named tile. */
  tiles: z.record(z.string(), UvRectSchema),
});

export const KitManifestSchema = z
  .object({
    version: z.literal(KIT_MANIFEST_VERSION),
    generator: z.string(),
    /** The kit id: a style id or `common`. */
    style: KitIdSchema,
    grid: z.object({ cell: z.literal(CELL_M), storey: z.literal(STOREY_M) }),
    atlas: KitAtlasSchema.nullable(),
    modules: z.array(KitModuleSchema),
  })
  .refine((m) => new Set(m.modules.map((x) => x.id)).size === m.modules.length, {
    message: "module ids must be unique",
    path: ["modules"],
  });

export type KitPlacement = z.infer<typeof KitPlacementSchema>;
export type KitSocket = z.infer<typeof KitSocketSchema>;
export type KitModule = z.infer<typeof KitModuleSchema>;
export type KitAtlas = z.infer<typeof KitAtlasSchema>;
export type KitManifest = z.infer<typeof KitManifestSchema>;

export function parseKitManifest(data: unknown): KitManifest {
  return KitManifestSchema.parse(data);
}

/** Extras the Blender exporter writes on each variant's root node (`userData` in three.js). */
export interface KitVariantExtras {
  hv_module: string;
  hv_variant: number;
  hv_style?: string;
}

/** Extras on a mesh node that plays a role inside a variant (`canopy`, `trunk`, `water`...). */
export interface KitPartExtras {
  hv_part: string;
}

export function isKitPartExtras(value: unknown): value is KitPartExtras {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).hv_part === "string";
}

export function isKitVariantExtras(value: unknown): value is KitVariantExtras {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.hv_module === "string" && typeof v.hv_variant === "number" && Number.isInteger(v.hv_variant);
}

/** Quarter-turn rotations of placed furniture (degrees, as in `users/{uid}/apartment/layout`). */
export type PlacementRotation = 0 | 90 | 180 | 270;

/** The size in metres of a placement footprint. */
export function placementSizeM(placement: { w: number; d: number; cell: number }): { w: number; d: number } {
  return { w: placement.w * placement.cell, d: placement.d * placement.cell };
}

/** Grid cells a placement footprint covers after a quarter-turn rotation (`w` and `d` swap at
 * 90 and 270 degrees). TODO(M17): occupancy and overlap checks for the placement mode. */
export function rotatedPlacementCells(placement: Pick<KitPlacement, "w" | "d">, rot: PlacementRotation): { w: number; d: number } {
  return rot === 90 || rot === 270 ? { w: placement.d, d: placement.w } : { w: placement.w, d: placement.d };
}

/** Whether a placed piece takes floor cells away from walking and from other floor pieces. */
export function placementBlocksFloor(placement: Pick<KitPlacement, "mount">): boolean {
  return placement.mount === "floor";
}
