import { describe, expect, it } from "vitest";
import { CELL_M, isKitVariantExtras, KitManifestSchema, ModuleIdSchema, parseKitManifest, STOREY_M } from "./kit";

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
  ])("rejects a bad %s", (_label, bad) => {
    expect(KitManifestSchema.safeParse(bad).success).toBe(false);
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
