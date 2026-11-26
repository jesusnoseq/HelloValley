/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box3, Texture } from "three";
import { describe, expect, it } from "vitest";
import { BUILDING_RECIPE_IDS, buildingRecipes, STYLE_IDS } from "@hellovalley/shared";
import { createDioramaStore } from "../state/dioramaStore";
import { buildBuildingMeshes, placementMatrix } from "./buildingMeshes";
import { AVAILABLE_STYLE_KITS, createKitLoader, KIT_GEOMETRY_ATTRIBUTES, kitGlow, kitUrl, LAMP_GLOW, resolveKitStyle } from "./kitLoader";

// Assembles every recipe with the committed europe kit, read from public/ the way the browser
// fetches it (the atlas image is stubbed: decoding it needs a DOM).
const PUBLIC = new URL("../../public/", import.meta.url);
const present = existsSync(fileURLToPath(new URL("assets/kits/european/kit-manifest.json", PUBLIC)));

const fetched: string[] = [];
function fetchFromPublic(url: string) {
  fetched.push(url);
  const file = fileURLToPath(new URL(url.replace(/^\//, ""), PUBLIC));
  const ok = existsSync(file);
  const bytes = ok ? readFileSync(file) : Buffer.alloc(0);
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(JSON.parse(bytes.toString("utf8"))),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
  });
}

const textures: string[] = [];
const loader = createKitLoader({
  baseUrl: "/",
  fetchImpl: fetchFromPublic,
  loadTexture: (url) => {
    textures.push(url);
    return Promise.resolve(new Texture());
  },
});

describe("style kits", () => {
  it("render every style with its own kit (no european fallback left)", () => {
    expect(AVAILABLE_STYLE_KITS).toEqual(["european", "mediterranean", "arabic", "japanese"]);
    expect(resolveKitStyle("mediterranean")).toBe("mediterranean");
    expect(resolveKitStyle("arabic")).toBe("arabic");
    expect(resolveKitStyle("japanese")).toBe("japanese");
    for (const style of STYLE_IDS) expect(resolveKitStyle(style)).toBe(AVAILABLE_STYLE_KITS.includes(style) ? style : "european");
    expect(kitUrl("european", "/")).toBe("/assets/kits/european/");
    expect(kitUrl("common", "/hv/")).toBe("/hv/assets/kits/common/");
  });

  it("are switched through the diorama store", () => {
    const store = createDioramaStore();
    expect(store.getState().style).toBe("european");
    store.getState().setStyle("japanese");
    expect(store.getState().style).toBe("japanese");
  });

  it("glow lamps above the bloom threshold only at night", () => {
    expect(kitGlow(0)).toEqual({ lamp: 0.2, window: 0 });
    expect(kitGlow(1).lamp).toBeCloseTo(0.2 + LAMP_GLOW);
    expect(kitGlow(1).window).toBeLessThan(1);
  });
});

describe.skipIf(!present)("building meshes (europe kit)", () => {
  it("loads a kit once, binds the atlas and caches module variants", async () => {
    const [a, b] = await Promise.all([loader.load("european"), loader.loadStyle("european")]);
    expect(a).toBe(b);
    expect(textures).toEqual(["/assets/kits/european/atlas.webp"]);
    expect(a.atlas?.flipY).toBe(false);
    expect(a.materials.atlas.map).toBe(a.atlas);
    expect(a.materials.atlas.vertexColors).toBe(true);
    const parts = await a.variantParts("wall.window", 1);
    expect(await a.variantParts("wall.window", 4)).toBe(parts);
    expect(parts.map((p) => p.kind).sort()).toEqual(["atlas", "glass"]);
    for (const { geometry } of parts) {
      for (const [name, size] of Object.entries(KIT_GEOMETRY_ATTRIBUTES)) {
        const attr = geometry.getAttribute(name);
        expect(attr.itemSize).toBe(size);
        expect(attr.array).toBeInstanceOf(Float32Array);
      }
    }
    expect(fetched.filter((u) => u.endsWith("wall.window.glb"))).toHaveLength(1);
    expect(loader.loaded().map((k) => k.id)).toEqual(["european"]);
  });

  it.each(BUILDING_RECIPE_IDS.map((id) => [id]))("%s renders as one merged mesh per material", async (id) => {
    const kit = await loader.load("european");
    const recipe = buildingRecipes()[id];
    const meshes = await buildBuildingMeshes(recipe, kit);
    const kinds = meshes.parts.map((p) => p.kind).sort();
    expect(kinds).toContain("atlas");
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(meshes.parts.length).toBeLessThanOrEqual(3);
    // Every placed variant's triangles end up in the merged meshes.
    const expected = meshes.assembled.placements.reduce((sum, p) => sum + kit.module(p.module).tris[p.variant]!, 0);
    expect(meshes.triangles).toBe(expected);
    // The merged geometry stays inside the assembler's manifest-derived bounds.
    const box = new Box3();
    for (const p of meshes.parts) box.union(p.geometry.boundingBox!);
    const { min, max } = meshes.assembled.bounds;
    box.min.toArray().forEach((v, i) => expect(v).toBeGreaterThanOrEqual(min[i]! - 1e-3));
    box.max.toArray().forEach((v, i) => expect(v).toBeLessThanOrEqual(max[i]! + 1e-3));
    expect(box.max.y).toBeGreaterThan(recipe.floors * 3);
    // Sign boards carry their icon on both faces.
    expect(meshes.signs.length).toBe(2 * recipe.attachments.filter((a) => a.icon).length);
    for (const p of meshes.parts) p.geometry.dispose();
  });

  const swaps = (["mediterranean", "arabic", "japanese"] as const).flatMap((style) => BUILDING_RECIPE_IDS.map((id) => [id, style] as const));
  it.each(swaps)("%s swaps to the %s kit without moving anything", async (id, style) => {
    const recipe = buildingRecipes()[id];
    const europe = await buildBuildingMeshes(recipe, await loader.loadStyle("european"));
    const kit = await loader.loadStyle(style);
    expect(kit.id).toBe(style);
    const other = await buildBuildingMeshes(recipe, kit);
    expect(other.assembled.placements).toEqual(europe.assembled.placements);
    expect(other.assembled.doors).toEqual(europe.assembled.doors);
    // It is really the other kit's geometry, every placed variant merged, within the bounds.
    const expected = other.assembled.placements.reduce((sum, p) => sum + kit.module(p.module).tris[p.variant]!, 0);
    expect(other.triangles).toBe(expected);
    expect(other.triangles).not.toBe(europe.triangles);
    expect(other.parts.map((p) => p.kind)).toContain("atlas");
    const box = new Box3();
    for (const p of other.parts) box.union(p.geometry.boundingBox!);
    const { min, max } = other.assembled.bounds;
    box.min.toArray().forEach((v, i) => expect(v).toBeGreaterThanOrEqual(min[i]! - 1e-3));
    box.max.toArray().forEach((v, i) => expect(v).toBeLessThanOrEqual(max[i]! + 1e-3));
    expect(other.signs.length).toBe(europe.signs.length);
    for (const p of [...europe.parts, ...other.parts]) p.geometry.dispose();
  });

  it("composes placement matrices like the shared transform", () => {
    const m = placementMatrix({ position: [3, 6, -2], rot: 1, scale: [2, 1.5, 1.5] });
    const e = m.elements;
    // Local (1, 0, 0) -> scaled 2 along x, turned to -z, then translated.
    expect([e[0]! + e[12]!, e[1]! + e[13]!, e[2]! + e[14]!].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([3, 6, -4]);
  });
});
