/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import {
  COMMON_KIT_ID,
  isKitPartExtras,
  isTreeModuleId,
  KIT_CANOPY_PART,
  KIT_CANOPY_TAG,
  KIT_COMMON_MODULE_IDS,
  kitCompletenessProblems,
  parseKitManifest,
} from "@hellovalley/shared";
import { canopyMeshes, countTris, kitParts, kitVariants, objectBounds, parseKitGlb } from "./kitGlb";

// The committed style-neutral kit (M06), generated with `npm run assets:build -- --style common`.
// Checks the manifest, the budgets, every GLB, and that tree canopies are their own mesh and
// material slot (so the client can sway them in a vertex shader, TODO(M12)).
const KIT = new URL("../../public/assets/kits/common/", import.meta.url);
const present = existsSync(fileURLToPath(new URL("kit-manifest.json", KIT)));

function read(file: string): Buffer {
  return readFileSync(fileURLToPath(new URL(file, KIT)));
}

function arrayBuffer(file: string): ArrayBuffer {
  const bytes = read(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function materials(mesh: Mesh): MeshStandardMaterial[] {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[];
}

const isCanopyMaterial = (m: MeshStandardMaterial) => m.userData.hv_canopy === true;

/** Problems with a variant's canopy split; empty when the canopy is a separate mesh whose
 * materials are all canopy materials and no other mesh uses one. */
function canopyProblems(variant: Object3D, needsTrunk: boolean): string[] {
  const problems: string[] = [];
  const parts = kitParts(variant);
  const canopy = canopyMeshes(variant);
  if (canopy.length === 0) problems.push("no canopy mesh");
  for (const mesh of canopy) {
    if (!materials(mesh).every(isCanopyMaterial)) problems.push("canopy mesh uses a non-canopy material");
  }
  const others = [...parts].filter(([part]) => part !== KIT_CANOPY_PART).flatMap(([, meshes]) => meshes);
  for (const mesh of others) {
    if (materials(mesh).some(isCanopyMaterial)) problems.push("canopy material used outside the canopy");
  }
  if (needsTrunk && (parts.get("trunk") ?? []).length === 0) problems.push("no trunk mesh");
  return problems;
}

/** The node that carries a mesh's `hv_part` extras (the mesh itself, or its group). */
function partNode(mesh: Mesh): Object3D {
  for (let n: Object3D | null = mesh; n; n = n.parent) if (isKitPartExtras(n.userData)) return n;
  return mesh;
}

describe.skipIf(!present)("common kit (public/assets/kits/common)", () => {
  const manifest = present ? parseKitManifest(JSON.parse(read("kit-manifest.json").toString("utf8"))) : null;
  const modules = manifest?.modules ?? [];

  it("has every M06 module with 3 variants within the GDD budgets", () => {
    expect(manifest?.style).toBe(COMMON_KIT_ID);
    expect(kitCompletenessProblems({ modules }, 3, KIT_COMMON_MODULE_IDS)).toEqual([]);
    expect(modules.map((m) => m.id).sort()).toEqual([...KIT_COMMON_MODULE_IDS].sort());
  });

  it("ships its atlas with the terrain and foliage tiles", () => {
    expect(existsSync(fileURLToPath(new URL(manifest?.atlas?.file ?? "missing", KIT)))).toBe(true);
    for (const tile of ["grass", "dirt", "sand", "cobble", "bark", "leaves"]) {
      expect(manifest?.atlas?.tiles[tile]).toBeDefined();
    }
  });

  it("tags every tree as a canopy module", () => {
    const trees = modules.filter((m) => isTreeModuleId(m.id));
    expect(trees).toHaveLength(6);
    for (const tree of trees) expect(tree.tags).toContain(KIT_CANOPY_TAG);
  });

  it.each(modules.map((m) => [m.id, m] as const))("%s GLB matches the manifest", async (_id, module) => {
    const gltf = await parseKitGlb(arrayBuffer(module.file));
    const variants = kitVariants(gltf.scene);
    expect([...variants.keys()].sort()).toEqual([...Array(module.variants).keys()]);
    for (const [index, root] of variants) {
      expect(root.userData).toMatchObject({ hv_module: module.id, hv_variant: index, hv_style: COMMON_KIT_ID });
      expect(countTris(root)).toBe(module.tris[index]);
      const bounds = objectBounds(root);
      for (let axis = 0; axis < 3; axis++) {
        expect(bounds.min[axis]).toBeGreaterThanOrEqual((module.bounds.min[axis] ?? 0) - 1e-3);
        expect(bounds.max[axis]).toBeLessThanOrEqual((module.bounds.max[axis] ?? 0) + 1e-3);
      }
      const label = `${module.id} v${index}`;
      if (module.tags.includes(KIT_CANOPY_TAG)) {
        expect(canopyProblems(root, isTreeModuleId(module.id)), label).toEqual([]);
      } else {
        expect(canopyMeshes(root), label).toHaveLength(0);
      }
      const water = kitParts(root).get("water") ?? [];
      if (module.id.startsWith("bank.") || module.id === "fountain") expect(water.length, label).toBeGreaterThan(0);
      for (const mesh of water) expect(materials(mesh).every((m) => m.userData.hv_water === true), label).toBe(true);
    }
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      expect(node.geometry.getAttribute("color")).toBeDefined();
      for (const material of materials(node)) {
        const kinds = ["hv_atlas", "hv_glow", "hv_water"].filter((k) => material.userData[k] === true);
        expect(kinds).toHaveLength(1);
        if (isCanopyMaterial(material)) expect(material.userData.hv_atlas).toBe(true);
      }
    });
  });

  it("puts each tree canopy's origin at the top of its trunk", async () => {
    for (const module of modules.filter((m) => isTreeModuleId(m.id))) {
      const gltf = await parseKitGlb(arrayBuffer(module.file));
      for (const [index, root] of kitVariants(gltf.scene)) {
        const node = partNode(canopyMeshes(root)[0]!);
        const cx = module.footprint.w / 2;
        const cz = -module.footprint.d / 2;
        // The sway pivot sits on the trunk axis, above the ground and below the canopy top.
        expect(node.position.y, `${module.id} v${index}`).toBeGreaterThan(0.2);
        expect(node.position.y).toBeLessThan(module.bounds.max[1] ?? 0);
        expect(Math.hypot(node.position.x - cx, node.position.z - cz), `${module.id} v${index}`).toBeLessThan(0.35);
      }
    }
  });
});
