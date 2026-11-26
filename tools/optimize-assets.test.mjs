import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestCubeDocument, testCubeManifest } from "./fixtures/make-test-kit.mjs";
import { Document } from "@gltf-transform/core";
import {
  createIO,
  cullHiddenGroundFaces,
  findKitDirs,
  HIDDEN_DOWN_NY,
  isCulledGroundModule,
  manifestFileIn,
  manifestGlbFiles,
  optimizeGlb,
  optimizeKit,
  parseArgs,
  resolveTextureMode,
  variantTriangles,
  WATER_TOP_Y,
} from "./optimize-assets.mjs";

/** One variant root with a land mesh (an up face, a down face, a submerged face) and a water mesh. */
function groundDocument() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tri = (points, material) => {
    const position = doc.createAccessor().setType("VEC3").setArray(new Float32Array(points.flat())).setBuffer(buffer);
    const indices = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([...Array(points.length).keys()])).setBuffer(buffer);
    return doc.createPrimitive().setAttribute("POSITION", position).setIndices(indices).setMaterial(material);
  };
  const land = doc.createMaterial("land");
  const water = doc.createMaterial("water").setExtras({ hv_water: true });
  const up = [[0, 0.1, 0], [0, 0.1, -1], [1, 0.1, 0]];
  const down = [[0, 0, 0], [1, 0, 0], [0, 0, -1]];
  const submerged = [[0, -0.4, 0], [0, -0.3, -1], [1, -0.3, 0]];
  const landPrim = tri([...up, ...down, ...submerged], land);
  const waterPrim = tri([[0, -0.15, 0], [0, -0.15, -1], [1, -0.15, 0]], water);
  const mesh = doc.createMesh("bank").addPrimitive(landPrim);
  const waterMesh = doc.createMesh("water").addPrimitive(waterPrim);
  const v0 = doc.createNode("v0").setExtras({ hv_variant: 0 }).addChild(doc.createNode("land").setMesh(mesh)).addChild(doc.createNode("water").setMesh(waterMesh));
  doc.createScene().addChild(v0);
  return doc;
}

const dirs = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "hv-opt-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("optimize-assets", () => {
  it("resolves texture modes", () => {
    expect(resolveTextureMode("auto", null)).toBe("webp");
    expect(resolveTextureMode("auto", "toktx")).toBe("ktx2");
    expect(resolveTextureMode("none", null)).toBe("none");
    expect(() => resolveTextureMode("ktx2", null)).toThrow(/KTX-Software/);
    expect(() => resolveTextureMode("avif", "ktx")).toThrow(/unknown/);
  });

  it("lists the GLBs of kit and character manifests", () => {
    expect(manifestGlbFiles({ modules: [{ file: "a.glb" }, { file: "b.glb" }] })).toEqual(["a.glb", "b.glb"]);
    const characters = { body: { file: "body.glb" }, animals: [{ file: "animal.fox.glb" }], outfits: [{ file: "outfit.baker.glb" }] };
    expect(manifestGlbFiles(characters)).toEqual(["body.glb", "animal.fox.glb", "outfit.baker.glb"]);
    const dir = tempDir();
    expect(manifestFileIn(dir)).toBeNull();
    writeFileSync(join(dir, "character-manifest.json"), JSON.stringify(characters));
    expect(manifestFileIn(dir)).toBe("character-manifest.json");
    expect(findKitDirs([dir])).toEqual([dir]);
  });

  it("parses arguments", () => {
    const opts = parseArgs(["kits", "--textures", "none", "--keep-png"]);
    expect(opts.textures).toBe("none");
    expect(opts.keepPng).toBe(true);
    expect(opts.paths).toHaveLength(1);
    expect(parseArgs(["--textures=webp"]).paths[0]).toMatch(/kits$/);
  });

  it("culls the ground faces the town camera never sees (M37)", () => {
    expect(isCulledGroundModule("bank.straight")).toBe(true);
    expect(isCulledGroundModule("terrain.cobble.edge")).toBe(true);
    expect(isCulledGroundModule("bank.water")).toBe(false);
    expect(isCulledGroundModule("fountain")).toBe(false);
    const doc = groundDocument();
    expect(variantTriangles(doc).get(0)).toBe(4);
    const { total, removed } = cullHiddenGroundFaces(doc);
    // The down face and the submerged face go; the top and the water surface stay.
    expect(total).toBe(2);
    expect(removed.get(0)).toBe(2);
    expect(variantTriangles(doc).get(0)).toBe(2);
    expect(WATER_TOP_Y).toBe(-0.15);
  });

  it("keeps the culling threshold in step with the town camera's pitch", () => {
    const source = readFileSync(new URL("../packages/client/src/scene/cameraMath.ts", import.meta.url), "utf8");
    const pitch = Number(/export const CAMERA_PITCH_DEG = (\d+(?:\.\d+)?);/.exec(source)?.[1]);
    expect(pitch).toBeGreaterThan(0);
    const rad = (pitch * Math.PI) / 180;
    // The steepest face the camera can still see from some yaw: sin(p)·ny + cos(p)·sqrt(1 - ny²) = 0.
    const limit = -Math.cos(rad);
    expect(HIDDEN_DOWN_NY).toBeLessThan(limit);
    expect(HIDDEN_DOWN_NY).toBeGreaterThan(limit - 0.05);
  });

  it("meshopt-compresses a module and keeps extras, colours and UVs", async () => {
    const io = await createIO();
    const raw = await io.writeBinary(buildTestCubeDocument());
    const out = await optimizeGlb(raw, { textures: "none" });
    const doc = await io.readBinary(out);
    const root = doc.getRoot();
    expect(root.listExtensionsUsed().map((e) => e.extensionName)).toContain("EXT_meshopt_compression");
    const variants = root.listNodes().filter((n) => typeof n.getExtras().hv_variant === "number");
    expect(variants.map((n) => n.getName()).sort()).toEqual(["v0", "v1", "v2"]);
    for (const mesh of root.listMeshes()) {
      expect(mesh.listPrimitives()[0].listSemantics()).toEqual(expect.arrayContaining(["COLOR_0", "TEXCOORD_0"]));
    }
  });

  it("optimizes a kit folder and converts the atlas to WebP", async () => {
    const root = tempDir();
    const kit = join(root, "european");
    mkdirSync(kit);
    const io = await createIO();
    writeFileSync(join(kit, "test.cube.glb"), await io.writeBinary(buildTestCubeDocument()));
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f3e9d2" } }).png().toBuffer();
    writeFileSync(join(kit, "atlas.png"), png);
    const manifest = { ...testCubeManifest(), atlas: { file: "atlas.png", size: 8, tiles: {} } };
    writeFileSync(join(kit, "kit-manifest.json"), JSON.stringify(manifest));

    expect(findKitDirs([root])).toEqual([kit]);
    const result = await optimizeKit(kit, { textures: "webp", log: () => {} });
    expect(result.mode).toBe("webp");
    expect(result.after).toBeGreaterThan(0);
    const written = JSON.parse(readFileSync(join(kit, "kit-manifest.json"), "utf8"));
    expect(written.atlas.file).toBe("atlas.webp");
    expect(existsSync(join(kit, "atlas.png"))).toBe(false);
    expect(readFileSync(join(kit, "atlas.webp")).subarray(8, 12).toString("ascii")).toBe("WEBP");

    // Idempotent: a second pass reads the meshopt GLB and keeps it valid.
    await optimizeKit(kit, { textures: "webp", log: () => {} });
    const doc = await io.read(join(kit, "test.cube.glb"));
    expect(doc.getRoot().listMeshes()).toHaveLength(3);
  });

  it("finds no kits in an empty folder", () => {
    expect(findKitDirs([tempDir(), join(tmpdir(), "hv-does-not-exist")])).toEqual([]);
  });

  it("keeps the committed fixture copyable", () => {
    // The Blender fixture is a valid input for another optimize pass.
    const kit = join(tempDir(), "european");
    mkdirSync(kit);
    const src = new URL("../packages/client/test/fixtures/kits/european/", import.meta.url);
    for (const f of ["kit-manifest.json", "test.cube.glb", "atlas.webp"]) copyFileSync(new URL(f, src), join(kit, f));
    return expect(optimizeKit(kit, { textures: "none", log: () => {} })).resolves.toMatchObject({ mode: "none" });
  });
});
