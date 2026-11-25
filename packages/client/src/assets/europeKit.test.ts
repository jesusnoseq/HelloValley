/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { kitCompletenessProblems, parseKitManifest } from "@hellovalley/shared";
import { countTris, kitVariants, objectBounds, parseKitGlb } from "./kitGlb";

// The committed europe kit (M05), generated with `npm run assets:build -- --style europe`.
// Checks the acceptance items that do not need a browser: the manifest validates, every
// building module is there with 3 variants inside its triangle budget, and every GLB decodes
// to what the manifest says.
const KIT = new URL("../../public/assets/kits/european/", import.meta.url);
const present = existsSync(fileURLToPath(new URL("kit-manifest.json", KIT)));

function read(file: string): Buffer {
  return readFileSync(fileURLToPath(new URL(file, KIT)));
}

function arrayBuffer(file: string): ArrayBuffer {
  const bytes = read(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe.skipIf(!present)("europe kit (public/assets/kits/european)", () => {
  const manifest = present ? parseKitManifest(JSON.parse(read("kit-manifest.json").toString("utf8"))) : null;
  const modules = manifest?.modules ?? [];

  it("is a complete style kit within the GDD budgets", () => {
    expect(manifest?.style).toBe("european");
    expect(kitCompletenessProblems({ modules })).toEqual([]);
    expect(modules.some((m) => m.tags.includes("test"))).toBe(false);
  });

  it("ships its atlas", () => {
    expect(manifest?.atlas).not.toBeNull();
    expect(existsSync(fileURLToPath(new URL(manifest?.atlas?.file ?? "missing", KIT)))).toBe(true);
    for (const tile of ["plaster", "timber", "roof_clay", "roof_slate", "brick", "cobble"]) {
      expect(manifest?.atlas?.tiles[tile]).toBeDefined();
    }
  });

  it.each(modules.map((m) => [m.id, m] as const))("%s GLB matches the manifest", async (_id, module) => {
    const gltf = await parseKitGlb(arrayBuffer(module.file));
    const variants = kitVariants(gltf.scene);
    expect([...variants.keys()].sort()).toEqual([...Array(module.variants).keys()]);
    for (const [index, root] of variants) {
      expect(root.userData).toMatchObject({ hv_module: module.id, hv_variant: index, hv_style: "european" });
      expect(countTris(root)).toBe(module.tris[index]);
      const bounds = objectBounds(root);
      for (let axis = 0; axis < 3; axis++) {
        expect(bounds.min[axis]).toBeGreaterThanOrEqual((module.bounds.min[axis] ?? 0) - 1e-3);
        expect(bounds.max[axis]).toBeLessThanOrEqual((module.bounds.max[axis] ?? 0) + 1e-3);
      }
    }
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      expect(node.geometry.getAttribute("color")).toBeDefined();
      expect(node.geometry.getAttribute("uv")).toBeDefined();
      const materials = (Array.isArray(node.material) ? node.material : [node.material]) as MeshStandardMaterial[];
      for (const material of materials) {
        const kinds = ["hv_atlas", "hv_glass", "hv_glow"].filter((k) => material.userData[k] === true);
        expect(kinds).toHaveLength(1);
        if (material.userData.hv_glow === true) expect(material.emissive.getHex()).not.toBe(0);
      }
    });
  });
});
