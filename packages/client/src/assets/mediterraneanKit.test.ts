/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import {
  KIT_BUILDING_MODULE_IDS,
  KIT_CANOPY_PART,
  KIT_CANOPY_TAG,
  KIT_STYLE_EXTRA_MODULE_IDS,
  kitCompletenessProblems,
  parseKitManifest,
  styleKitModuleIds,
} from "@hellovalley/shared";
import { canopyMeshes, countTris, kitParts, kitVariants, objectBounds, parseKitGlb } from "./kitGlb";

// The committed Mediterranean kit (M32), generated with
// `npm run assets:build -- --style mediterranean`. The manifest validates, every building module of
// the europe kit is there with the same footprint and sockets (so recipes need no changes), the
// budgets hold, and every GLB decodes to what the manifest says.
const KITS = new URL("../../public/assets/kits/", import.meta.url);
const KIT = new URL("mediterranean/", KITS);
const present = existsSync(fileURLToPath(new URL("kit-manifest.json", KIT)));

function read(file: string, kit: URL = KIT): Buffer {
  return readFileSync(fileURLToPath(new URL(file, kit)));
}

function arrayBuffer(file: string): ArrayBuffer {
  const bytes = read(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function materials(mesh: Mesh): MeshStandardMaterial[] {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[];
}

describe.skipIf(!present)("mediterranean kit (public/assets/kits/mediterranean)", () => {
  const manifest = present ? parseKitManifest(JSON.parse(read("kit-manifest.json").toString("utf8"))) : null;
  const europe = present ? parseKitManifest(JSON.parse(read("european/kit-manifest.json", KITS).toString("utf8"))) : null;
  const modules = manifest?.modules ?? [];

  it("is a complete style kit within the GDD budgets", () => {
    expect(manifest?.style).toBe("mediterranean");
    expect(kitCompletenessProblems({ modules }, 3, styleKitModuleIds("mediterranean"))).toEqual([]);
    expect(modules.map((m) => m.id).sort()).toEqual([...styleKitModuleIds("mediterranean")].sort());
    expect(modules.some((m) => m.tags.includes("test"))).toBe(false);
  });

  it("mirrors the europe kit's building modules (ids, footprints, sockets, fits)", () => {
    for (const id of KIT_BUILDING_MODULE_IDS) {
      const eu = europe!.modules.find((m) => m.id === id)!;
      const med = modules.find((m) => m.id === id)!;
      expect(med.footprint, id).toEqual(eu.footprint);
      expect(med.sockets, id).toEqual(eu.sockets);
      expect(med.variants, id).toBe(eu.variants);
      expect(med.tags.filter((t) => t.startsWith("fits:")), id).toEqual(eu.tags.filter((t) => t.startsWith("fits:")));
    }
  });

  it("ships its atlas with the Mediterranean tiles", () => {
    expect(manifest?.atlas).not.toBeNull();
    expect(existsSync(fileURLToPath(new URL(manifest?.atlas?.file ?? "missing", KIT)))).toBe(true);
    for (const tile of ["stucco", "roof_clay", "terracotta", "paving", "timber", "leaves", "bark"]) {
      expect(manifest?.atlas?.tiles[tile]).toBeDefined();
    }
  });

  it.each(modules.map((m) => [m.id, m] as const))("%s GLB matches the manifest", async (_id, module) => {
    const gltf = await parseKitGlb(arrayBuffer(module.file));
    const variants = kitVariants(gltf.scene);
    expect([...variants.keys()].sort()).toEqual([...Array(module.variants).keys()]);
    const canopy = module.tags.includes(KIT_CANOPY_TAG);
    expect(canopy).toBe(!(KIT_BUILDING_MODULE_IDS as readonly string[]).includes(module.id) && module.id !== "pot.terracotta");
    for (const [index, root] of variants) {
      expect(root.userData).toMatchObject({ hv_module: module.id, hv_variant: index, hv_style: "mediterranean" });
      expect(countTris(root)).toBe(module.tris[index]);
      const bounds = objectBounds(root);
      for (let axis = 0; axis < 3; axis++) {
        expect(bounds.min[axis]).toBeGreaterThanOrEqual((module.bounds.min[axis] ?? 0) - 1e-3);
        expect(bounds.max[axis]).toBeLessThanOrEqual((module.bounds.max[axis] ?? 0) + 1e-3);
      }
      if (canopy) {
        // Pergola, bougainvillea and lemon tree: a trunk mesh and a separate swaying canopy.
        const leaves = canopyMeshes(root);
        expect(leaves.length).toBeGreaterThan(0);
        for (const mesh of leaves) expect(materials(mesh).every((m) => m.userData.hv_canopy === true)).toBe(true);
        expect((kitParts(root).get("trunk") ?? []).length).toBeGreaterThan(0);
        expect(kitParts(root).has(KIT_CANOPY_PART)).toBe(true);
      }
    }
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      expect(node.geometry.getAttribute("color")).toBeDefined();
      expect(node.geometry.getAttribute("uv")).toBeDefined();
      for (const material of materials(node)) {
        const kinds = ["hv_atlas", "hv_glass", "hv_glow"].filter((k) => material.userData[k] === true);
        expect(kinds).toHaveLength(1);
        if (material.userData.hv_glow === true) expect(material.emissive.getHex()).not.toBe(0);
        if (material.userData.hv_canopy === true) expect(canopy).toBe(true);
      }
    });
  });

  it("keeps the style-only extras out of the building recipes' module set", () => {
    for (const id of KIT_STYLE_EXTRA_MODULE_IDS.mediterranean) expect(KIT_BUILDING_MODULE_IDS as readonly string[]).not.toContain(id);
  });
});
