/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { parseKitManifest } from "@hellovalley/shared";
import { countTris, fetchKitManifest, kitVariants, loadKitModule, objectBounds, parseKitGlb } from "./kitGlb";

// Committed fixtures, both meshopt-compressed by tools/optimize-assets:
// - kits/: the real Blender output for the test.cube module
//   (`npm run assets:build -- --modules test.cube --out packages/client/test/fixtures/kits`);
// - kits-synthetic/: the same layout written without Blender (`npm run assets:fixtures`).
const FIXTURES: [string, URL][] = [
  ["blender", new URL("../../test/fixtures/kits/european/", import.meta.url)],
  ["synthetic", new URL("../../test/fixtures/kits-synthetic/european/", import.meta.url)],
];

function fixtureReader(kitDir: URL) {
  const read = (file: string) => readFileSync(fileURLToPath(new URL(file, kitDir)));
  const arrayBuffer = (file: string): ArrayBuffer => {
    const bytes = read(file);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };
  const fakeFetch = async (url: string) => {
    const file = url.split("/").pop() ?? "";
    try {
      const bytes = read(file);
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
        arrayBuffer: async () => arrayBuffer(file),
      };
    } catch {
      return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) };
    }
  };
  return { read, arrayBuffer, fakeFetch };
}

describe.each(FIXTURES)("kit GLB loading (%s fixture)", (_name, kitDir) => {
  const { read, arrayBuffer, fakeFetch } = fixtureReader(kitDir);
  const manifest = parseKitManifest(JSON.parse(read("kit-manifest.json").toString("utf8")));
  const cube = manifest.modules.find((m) => m.id === "test.cube");

  it("has a valid manifest with the test cube", () => {
    expect(manifest.style).toBe("european");
    expect(cube?.variants).toBe(3);
    expect(cube?.footprint).toEqual({ w: 1, d: 1, h: 1 });
  });

  it("decodes the meshopt GLB and exposes every variant by its extras", async () => {
    const gltf = await parseKitGlb(arrayBuffer("test.cube.glb"));
    const variants = kitVariants(gltf.scene);
    expect([...variants.keys()].sort()).toEqual([0, 1, 2]);
    for (const [index, root] of variants) {
      expect(root.userData).toMatchObject({ hv_module: "test.cube", hv_variant: index, hv_style: "european" });
      expect(countTris(root)).toBe(cube?.tris[index]);
      // The pivot is the bottom-left-front corner: x [0, 1], y [0, 1], z [-1, 0].
      const bounds = objectBounds(root);
      bounds.min.forEach((v, i) => expect(v).toBeCloseTo(cube?.bounds.min[i] ?? NaN, 3));
      bounds.max.forEach((v, i) => expect(v).toBeCloseTo(cube?.bounds.max[i] ?? NaN, 3));
    }
  });

  it("keeps vertex colours, UVs and the atlas material marker", async () => {
    const gltf = await parseKitGlb(arrayBuffer("test.cube.glb"));
    const meshes: Mesh[] = [];
    gltf.scene.traverse((n) => {
      if (n instanceof Mesh) meshes.push(n);
    });
    expect(meshes.length).toBe(3);
    for (const mesh of meshes) {
      expect(mesh.geometry.getAttribute("color")).toBeDefined();
      expect(mesh.geometry.getAttribute("uv")).toBeDefined();
      const material = mesh.material as MeshStandardMaterial;
      expect(material.vertexColors).toBe(true);
      expect(material.color.getHex()).toBe(0xffffff);
      expect(material.userData.hv_atlas).toBe(true);
    }
  });

  it("loads the manifest and a module through fetch", async () => {
    const fetched = await fetchKitManifest("/assets/kits/european/", fakeFetch);
    const module = fetched.modules[0];
    if (!module) throw new Error("fixture has no modules");
    const loaded = await loadKitModule("/assets/kits/european", module, { fetchImpl: fakeFetch });
    expect(loaded.variants.size).toBe(3);
  });

  it("rejects a missing kit file", async () => {
    await expect(fetchKitManifest("/assets/kits/japanese", () => fakeFetch("missing.json"))).rejects.toThrow(/HTTP 404/);
  });
});
