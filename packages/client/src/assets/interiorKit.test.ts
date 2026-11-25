/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mesh, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import {
  FURNITURE_ITEM_LOOKS,
  INTERIOR_KIT_ID,
  isRoomPanelModuleId,
  KIT_INTERIOR_MODULE_IDS,
  kitCompletenessProblems,
  parseKitManifest,
  PLACEMENT_CELL_M,
  placementSizeM,
} from "@hellovalley/shared";
import { countTris, kitVariants, objectBounds, parseKitGlb } from "./kitGlb";

// The committed interior and furniture kit (M08), generated with
// `npm run assets:build -- --style interior`. Checks the manifest, the budgets, that every
// furniture piece declares a placement footprint on the 0.5 m grid and stays inside it, and
// every GLB.
const KIT = new URL("../../public/assets/kits/interior/", import.meta.url);
const present = existsSync(fileURLToPath(new URL("kit-manifest.json", KIT)));
const EPS = 1e-3;

function read(file: string): Buffer {
  return readFileSync(fileURLToPath(new URL(file, KIT)));
}

function arrayBuffer(file: string): ArrayBuffer {
  const bytes = read(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe.skipIf(!present)("interior kit (public/assets/kits/interior)", () => {
  const manifest = present ? parseKitManifest(JSON.parse(read("kit-manifest.json").toString("utf8"))) : null;
  const modules = manifest?.modules ?? [];

  it("has every M08 module with 3 variants within the GDD budgets", () => {
    expect(manifest?.style).toBe(INTERIOR_KIT_ID);
    expect(kitCompletenessProblems({ modules }, 3, KIT_INTERIOR_MODULE_IDS)).toEqual([]);
    expect(modules.map((m) => m.id).sort()).toEqual([...KIT_INTERIOR_MODULE_IDS].sort());
  });

  it("ships its atlas", () => {
    expect(existsSync(fileURLToPath(new URL(manifest?.atlas?.file ?? "missing", KIT)))).toBe(true);
    for (const tile of ["floorboards", "tiles", "brick", "fabric", "straw"]) expect(manifest?.atlas?.tiles[tile]).toBeDefined();
  });

  it("declares a placement footprint for every furniture piece and none for room panels", () => {
    for (const module of modules) {
      if (isRoomPanelModuleId(module.id)) {
        expect(module.placement, module.id).toBeUndefined();
        continue;
      }
      expect(module.placement, module.id).toBeDefined();
      expect(module.placement?.cell).toBe(PLACEMENT_CELL_M);
      expect(module.tags).toContain("furniture");
    }
  });

  it("keeps every piece inside its placement box (glTF: x in [0, w], z in [-d, 0])", () => {
    for (const module of modules) {
      if (!module.placement) continue;
      const { w, d } = placementSizeM(module.placement);
      const { min, max } = module.bounds;
      expect(min[0], module.id).toBeGreaterThanOrEqual(-EPS);
      expect(max[0], module.id).toBeLessThanOrEqual(w + EPS);
      expect(min[2], module.id).toBeGreaterThanOrEqual(-d - EPS);
      expect(max[2], module.id).toBeLessThanOrEqual(EPS);
      expect(min[1], module.id).toBeGreaterThanOrEqual(-EPS);
      expect(max[1], module.id).toBeLessThanOrEqual(module.footprint.h + EPS);
      for (const socket of module.sockets) {
        expect(socket.pos[0], `${module.id} ${socket.name}`).toBeGreaterThanOrEqual(-EPS);
        expect(socket.pos[0]).toBeLessThanOrEqual(w + EPS);
        expect(socket.pos[2], `${module.id} ${socket.name}`).toBeGreaterThanOrEqual(-d - EPS);
        expect(socket.pos[2]).toBeLessThanOrEqual(EPS);
      }
    }
  });

  it("shows every furniture item with an existing module variant", () => {
    const byId = new Map(modules.map((m) => [m.id, m]));
    for (const [item, look] of Object.entries(FURNITURE_ITEM_LOOKS)) {
      const module = byId.get(look.module);
      expect(module, item).toBeDefined();
      expect(look.variant, item).toBeLessThan(module?.variants ?? 0);
      expect(module?.placement, item).toBeDefined();
    }
  });

  it.each(modules.map((m) => [m.id, m] as const))("%s GLB matches the manifest", async (_id, module) => {
    const gltf = await parseKitGlb(arrayBuffer(module.file));
    const variants = kitVariants(gltf.scene);
    expect([...variants.keys()].sort()).toEqual([...Array(module.variants).keys()]);
    for (const [index, root] of variants) {
      expect(root.userData).toMatchObject({ hv_module: module.id, hv_variant: index, hv_style: INTERIOR_KIT_ID });
      expect(countTris(root)).toBe(module.tris[index]);
      const bounds = objectBounds(root);
      for (let axis = 0; axis < 3; axis++) {
        expect(bounds.min[axis]).toBeGreaterThanOrEqual((module.bounds.min[axis] ?? 0) - EPS);
        expect(bounds.max[axis]).toBeLessThanOrEqual((module.bounds.max[axis] ?? 0) + EPS);
      }
    }
    let glows = 0;
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      expect(node.geometry.getAttribute("color")).toBeDefined();
      const materials = (Array.isArray(node.material) ? node.material : [node.material]) as MeshStandardMaterial[];
      for (const material of materials) {
        const kinds = ["hv_atlas", "hv_glass", "hv_glow"].filter((k) => material.userData[k] === true);
        expect(kinds).toHaveLength(1);
        if (material.userData.hv_glow === true) {
          expect(material.emissive.getHex()).not.toBe(0);
          glows++;
        }
      }
    });
    // Light sources glow (lamps, the bakery oven fire).
    if (module.tags.includes("light")) expect(glows, module.id).toBeGreaterThan(0);
  });
});
