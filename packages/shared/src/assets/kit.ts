import { z } from "zod";
import { StyleIdSchema } from "../data/styles";

/**
 * Kit grid (GDD §7.2): 1 m cells, 3 m storeys. Modules pivot at their bottom-left-front
 * corner. Keep in sync with tools/blender/hvkit/grid.py (a Python test checks this).
 */
export const CELL_M = 1;
export const STOREY_M = 3;

/** kit-manifest.json format version; matches MANIFEST_VERSION in tools/blender/hvkit/manifest.py. */
export const KIT_MANIFEST_VERSION = 1;
export const KIT_MANIFEST_FILE = "kit-manifest.json";

/** Dotted lowercase semantic ids such as `wall.plain` or `roof.stepped_gable`. */
export const ModuleIdSchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/);

const FileNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/);
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const UvRectSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([u0, v0, u1, v1]) => u0 < u1 && v0 < v1, "an atlas rect needs u0 < u1 and v0 < v1");

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
  })
  .refine((m) => m.tris.length === m.variants, { message: "tris needs one count per variant", path: ["tris"] })
  .refine((m) => m.bounds.min.every((lo, i) => lo <= (m.bounds.max[i] ?? lo)), {
    message: "bounds min must not exceed max",
    path: ["bounds"],
  })
  .refine((m) => new Set(m.sockets.map((s) => s.name)).size === m.sockets.length, {
    message: "socket names must be unique",
    path: ["sockets"],
  });

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
    style: StyleIdSchema,
    grid: z.object({ cell: z.literal(CELL_M), storey: z.literal(STOREY_M) }),
    atlas: KitAtlasSchema.nullable(),
    modules: z.array(KitModuleSchema),
  })
  .refine((m) => new Set(m.modules.map((x) => x.id)).size === m.modules.length, {
    message: "module ids must be unique",
    path: ["modules"],
  });

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

export function isKitVariantExtras(value: unknown): value is KitVariantExtras {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.hv_module === "string" && typeof v.hv_variant === "number" && Number.isInteger(v.hv_variant);
}
