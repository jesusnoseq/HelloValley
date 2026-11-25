import { describe, expect, it } from "vitest";
import {
  CELL_M,
  isKitVariantExtras,
  KitManifestSchema,
  ModuleIdSchema,
  PLACEMENT_CELL_M,
  parseKitManifest,
  placementBlocksFloor,
  placementSizeM,
  rotatedPlacementCells,
  STOREY_M,
} from "./kit";

const cube = {
  id: "test.cube",
  file: "test.cube.glb",
  footprint: { w: 1, d: 1, h: 1 },
  variants: 3,
  bounds: { min: [0, 0, -1], max: [1, 1, 0] },
  sockets: [
    { name: "top", kind: "stack", pos: [0.5, 1, -0.5], normal: [0, 1, 0] },
    { name: "front", kind: "attach", pos: [0.5, 0.5, 0], normal: [0, 0, 1] },
  ],
  tris: [108, 108, 108],
  tags: ["test"],
};

const bed = {
  ...cube,
  id: "bed",
  file: "bed.glb",
  footprint: { w: 1, d: 2, h: 1.1 },
  bounds: { min: [0, 0, -2], max: [1, 1.1, 0] },
  tags: ["furniture"],
  placement: { cell: 0.5, w: 2, d: 4, mount: "floor", againstWall: true },
};

const manifest = {
  version: 1,
  generator: "hellovalley-blender/1",
  style: "european",
  grid: { cell: 1, storey: 3 },
  atlas: { file: "atlas.webp", size: 512, tiles: { plaster: [0.25, 0.0078, 0.4922, 0.2422] } },
  modules: [cube],
};

describe("kit manifest schema", () => {
  it("uses the GDD grid", () => {
    expect(CELL_M).toBe(1);
    expect(STOREY_M).toBe(3);
  });

  it("accepts a generator manifest", () => {
    const parsed = parseKitManifest(manifest);
    expect(parsed.modules[0]?.sockets[0]?.kind).toBe("stack");
    expect(KitManifestSchema.safeParse({ ...manifest, atlas: null }).success).toBe(true);
    const { tags: _tags, ...noTags } = cube;
    expect(parseKitManifest({ ...manifest, modules: [noTags] }).modules[0]?.tags).toEqual([]);
  });

  it.each([
    ["version", { ...manifest, version: 2 }],
    ["unknown style", { ...manifest, style: "martian" }],
    ["grid", { ...manifest, grid: { cell: 2, storey: 3 } }],
    ["atlas format", { ...manifest, atlas: { ...manifest.atlas, file: "atlas.bmp" } }],
    ["atlas rect", { ...manifest, atlas: { ...manifest.atlas, tiles: { a: [0.5, 0, 0.25, 1] } } }],
    ["duplicate ids", { ...manifest, modules: [cube, cube] }],
    ["tris count", { ...manifest, modules: [{ ...cube, tris: [1] }] }],
    ["bounds order", { ...manifest, modules: [{ ...cube, bounds: { min: [2, 0, 0], max: [1, 1, 1] } }] }],
    ["socket kind", { ...manifest, modules: [{ ...cube, sockets: [{ ...cube.sockets[0], kind: "glue" }] }] }],
    ["duplicate socket", { ...manifest, modules: [{ ...cube, sockets: [cube.sockets[0], cube.sockets[0]] }] }],
    ["file type", { ...manifest, modules: [{ ...cube, file: "cube.fbx" }] }],
    ["footprint", { ...manifest, modules: [{ ...cube, footprint: { w: 0, d: 1, h: 1 } }] }],
    ["vec3", { ...manifest, modules: [{ ...cube, bounds: { min: [0, 0], max: [1, 1, 0] } }] }],
    ["placement cell", { ...manifest, modules: [{ ...bed, placement: { ...bed.placement, cell: 1 } }] }],
    ["placement mount", { ...manifest, modules: [{ ...bed, placement: { ...bed.placement, mount: "ceiling" } }] }],
    ["placement size", { ...manifest, modules: [{ ...bed, placement: { ...bed.placement, w: 0 } }] }],
    ["placement fit", { ...manifest, modules: [{ ...bed, placement: { ...bed.placement, d: 5 } }] }],
    ["placement flag", { ...manifest, modules: [{ ...bed, placement: { ...bed.placement, againstWall: undefined } }] }],
  ])("rejects a bad %s", (_label, bad) => {
    expect(KitManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts furniture with a placement footprint", () => {
    const parsed = parseKitManifest({ ...manifest, style: "interior", modules: [cube, bed] });
    expect(parsed.modules[0]?.placement).toBeUndefined();
    expect(parsed.modules[1]?.placement).toEqual({ cell: PLACEMENT_CELL_M, w: 2, d: 4, mount: "floor", againstWall: true });
  });

  it("measures and rotates placement footprints", () => {
    expect(PLACEMENT_CELL_M).toBe(0.5);
    expect(placementSizeM(bed.placement)).toEqual({ w: 1, d: 2 });
    expect(rotatedPlacementCells(bed.placement, 0)).toEqual({ w: 2, d: 4 });
    expect(rotatedPlacementCells(bed.placement, 90)).toEqual({ w: 4, d: 2 });
    expect(rotatedPlacementCells(bed.placement, 180)).toEqual({ w: 2, d: 4 });
    expect(rotatedPlacementCells(bed.placement, 270)).toEqual({ w: 4, d: 2 });
    expect(placementBlocksFloor({ mount: "floor" })).toBe(true);
    for (const mount of ["rug", "wall", "surface"] as const) expect(placementBlocksFloor({ mount })).toBe(false);
  });

  it("validates module ids", () => {
    for (const ok of ["wall.plain", "roof.stepped_gable", "test.cube", "lamp"]) expect(ModuleIdSchema.safeParse(ok).success).toBe(true);
    for (const bad of ["Wall.plain", "wall..plain", ".wall", "wall-plain", ""]) expect(ModuleIdSchema.safeParse(bad).success).toBe(false);
  });

  it("recognises variant extras", () => {
    expect(isKitVariantExtras({ hv_module: "test.cube", hv_variant: 2, hv_style: "european" })).toBe(true);
    expect(isKitVariantExtras({ hv_module: "test.cube", hv_variant: 1.5 })).toBe(false);
    expect(isKitVariantExtras({ hv_variant: 0 })).toBe(false);
    expect(isKitVariantExtras(null)).toBe(false);
  });
});
