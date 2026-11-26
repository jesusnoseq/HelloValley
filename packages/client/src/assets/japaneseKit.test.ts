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

// The committed Japanese kit (M34), generated with
// `npm run assets:build -- --style japanese`. The manifest validates, every building module of
// the europe kit is there with the same footprint and sockets (so recipes need no changes), the
// budgets hold, and every GLB decodes to what the manifest says.
const KITS = new URL("../../public/assets/kits/", import.meta.url);
const KIT = new URL("japanese/", KITS);
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

const TREES = ["tree.pine", "tree.maple"];

describe.skipIf(!present)("japanese kit (public/assets/kits/japanese)", () => {
  const manifest = present ? parseKitManifest(JSON.parse(read("kit-manifest.json").toString("utf8"))) : null;
  const europe = present ? parseKitManifest(JSON.parse(read("european/kit-manifest.json", KITS).toString("utf8"))) : null;
  const common = present ? parseKitManifest(JSON.parse(read("common/kit-manifest.json", KITS).toString("utf8"))) : null;
  const modules = manifest?.modules ?? [];

  it("is a complete style kit within the GDD budgets", () => {
    expect(manifest?.style).toBe("japanese");
    expect(kitCompletenessProblems({ modules }, 3, styleKitModuleIds("japanese"))).toEqual([]);
    expect(modules.map((m) => m.id).sort()).toEqual([...styleKitModuleIds("japanese")].sort());
    expect(modules.some((m) => m.tags.includes("test"))).toBe(false);
  });

  it("mirrors the europe kit's building modules (ids, footprints, sockets, fits)", () => {
    for (const id of KIT_BUILDING_MODULE_IDS) {
      const eu = europe!.modules.find((m) => m.id === id)!;
      const other = modules.find((m) => m.id === id)!;
      expect(other.footprint, id).toEqual(eu.footprint);
      expect(other.sockets, id).toEqual(eu.sockets);
      expect(other.variants, id).toBe(eu.variants);
      expect(other.tags.filter((t) => t.startsWith("fits:")), id).toEqual(eu.tags.filter((t) => t.startsWith("fits:")));
    }
  });

  it("ships its atlas with the Japanese tiles", () => {
    expect(manifest?.atlas).not.toBeNull();
    expect(existsSync(fileURLToPath(new URL(manifest?.atlas?.file ?? "missing", KIT)))).toBe(true);
    for (const tile of ["shikkui", "timber", "kawara", "paving", "gravel", "bamboo", "leaves", "bark"]) {
      expect(manifest?.atlas?.tiles[tile]).toBeDefined();
    }
  });

  it.each(modules.map((m) => [m.id, m] as const))("%s GLB matches the manifest", async (_id, module) => {
    const gltf = await parseKitGlb(arrayBuffer(module.file));
    const variants = kitVariants(gltf.scene);
    expect([...variants.keys()].sort()).toEqual([...Array(module.variants).keys()]);
    const canopy = module.tags.includes(KIT_CANOPY_TAG);
    expect(canopy).toBe(TREES.includes(module.id));
    for (const [index, root] of variants) {
      expect(root.userData).toMatchObject({ hv_module: module.id, hv_variant: index, hv_style: "japanese" });
      expect(countTris(root)).toBe(module.tris[index]);
      const bounds = objectBounds(root);
      for (let axis = 0; axis < 3; axis++) {
        expect(bounds.min[axis]).toBeGreaterThanOrEqual((module.bounds.min[axis] ?? 0) - 1e-3);
        expect(bounds.max[axis]).toBeLessThanOrEqual((module.bounds.max[axis] ?? 0) + 1e-3);
      }
      if (canopy) {
        // Pine and maple: a trunk mesh and a separate swaying canopy.
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
        const kinds = ["hv_atlas", "hv_glass", "hv_glow", "hv_water"].filter((k) => material.userData[k] === true);
        expect(kinds).toHaveLength(1);
        if (material.userData.hv_glow === true) expect(material.emissive.getHex()).not.toBe(0);
        if (material.userData.hv_canopy === true) expect(canopy).toBe(true);
      }
    });
  });

  it("lights its lamps and stone lanterns, and glows its shoji at night", async () => {
    for (const id of ["lamp", "lantern.stone"]) {
      const gltf = await parseKitGlb(arrayBuffer(modules.find((m) => m.id === id)!.file));
      let glow = 0;
      gltf.scene.traverse((node) => {
        if (node instanceof Mesh) glow += materials(node).filter((m) => m.userData.hv_glow === true).length;
      });
      expect(glow, id).toBeGreaterThan(0);
    }
    // Shoji paper uses the glass slot, which the town lights at night like window panes.
    const window = await parseKitGlb(arrayBuffer(modules.find((m) => m.id === "wall.window")!.file));
    let glass = 0;
    window.scene.traverse((node) => {
      if (node instanceof Mesh) glass += materials(node).filter((m) => m.userData.hv_glass === true).length;
    });
    expect(glass).toBeGreaterThan(0);
  });

  it("builds the wooden bridge on the stone bridge's footprint and sockets", () => {
    const wooden = modules.find((m) => m.id === "bridge.wooden")!;
    const stone = common!.modules.find((m) => m.id === "bridge.stone")!;
    expect([wooden.footprint.w, wooden.footprint.d]).toEqual([stone.footprint.w, stone.footprint.d]);
    expect(wooden.sockets).toEqual(stone.sockets);
    expect(wooden.tags).toContain("walkable");
    // It reaches down into the river bed like the stone one.
    expect(wooden.bounds.min[1]).toBeLessThan(-0.3);
  });

  it("keeps the style-only extras out of the building recipes' module set", () => {
    for (const id of KIT_STYLE_EXTRA_MODULE_IDS.japanese) expect(KIT_BUILDING_MODULE_IDS as readonly string[]).not.toContain(id);
  });
});
