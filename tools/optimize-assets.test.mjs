import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestCubeDocument, testCubeManifest } from "./fixtures/make-test-kit.mjs";
import { createIO, findKitDirs, manifestFileIn, manifestGlbFiles, optimizeGlb, optimizeKit, parseArgs, resolveTextureMode } from "./optimize-assets.mjs";

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
