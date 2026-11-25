import { Box3, Mesh, type Object3D } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  isKitPartExtras,
  isKitVariantExtras,
  KIT_CANOPY_PART,
  KIT_MANIFEST_FILE,
  type KitManifest,
  type KitModule,
  parseKitManifest,
} from "@hellovalley/shared";

/**
 * Low-level loading of generated kit files (tools/blender → public/assets/kits/{style}/).
 * The style-aware loader with caching and the shared atlas texture is scene/kitLoader.ts (M10);
 * this module only reads and validates what the generator writes.
 */

/** A GLTFLoader that decodes EXT_meshopt_compression (tools/optimize-assets). */
export function createKitGltfLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // Kit GLBs embed no textures (the atlas is a separate file, see scene/kitLoader.ts), so no
  // KTX2Loader is needed here. TODO(M37): KTX2 atlases.
  return loader;
}

export function parseKitGlb(data: ArrayBuffer, loader: GLTFLoader = createKitGltfLoader()): Promise<GLTF> {
  return loader.parseAsync(data, "");
}

/** The variant roots of a module GLB, keyed by `hv_variant` (from the node extras). */
export function kitVariants(root: Object3D): Map<number, Object3D> {
  const variants = new Map<number, Object3D>();
  root.traverse((node) => {
    if (isKitVariantExtras(node.userData) && !variants.has(node.userData.hv_variant)) {
      variants.set(node.userData.hv_variant, node);
    }
  });
  return variants;
}

/** The meshes of a variant grouped by their `hv_part` extras (`canopy`, `trunk`, `water`...);
 * meshes without one are listed under "". A multi-material node becomes a group of meshes in
 * three.js, so the part is read from the nearest tagged ancestor. */
export function kitParts(variant: Object3D): Map<string, Mesh[]> {
  const parts = new Map<string, Mesh[]>();
  variant.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    let part = "";
    for (let n: Object3D | null = node; n && n !== variant; n = n.parent) {
      if (isKitPartExtras(n.userData)) {
        part = n.userData.hv_part;
        break;
      }
    }
    const list = parts.get(part) ?? [];
    list.push(node);
    parts.set(part, list);
  });
  return parts;
}

/** The canopy meshes of a tree or plant variant: the client sways these in a vertex shader
 * around their node origin (the top of the trunk). TODO(M12): the sway material. */
export function canopyMeshes(variant: Object3D): Mesh[] {
  return kitParts(variant).get(KIT_CANOPY_PART) ?? [];
}

/** Triangles in an object's meshes (indexed or not). */
export function countTris(root: Object3D): number {
  let tris = 0;
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const geometry = node.geometry;
    const count = geometry.index ? geometry.index.count : (geometry.getAttribute("position")?.count ?? 0);
    tris += Math.floor(count / 3);
  });
  return tris;
}

export function objectBounds(root: Object3D): { min: [number, number, number]; max: [number, number, number] } {
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root, true);
  return { min: box.min.toArray(), max: box.max.toArray() };
}

function joinUrl(base: string, file: string): string {
  return `${base.replace(/\/+$/, "")}/${file}`;
}

export type FetchLike = (url: string) => Promise<Pick<Response, "ok" | "status" | "json" | "arrayBuffer">>;

export async function fetchKitManifest(kitUrl: string, fetchImpl: FetchLike = fetch): Promise<KitManifest> {
  const url = joinUrl(kitUrl, KIT_MANIFEST_FILE);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`kit manifest ${url}: HTTP ${res.status}`);
  return parseKitManifest(await res.json());
}

export interface LoadedKitModule {
  module: KitModule;
  gltf: GLTF;
  variants: Map<number, Object3D>;
}

export async function loadKitModule(
  kitUrl: string,
  module: KitModule,
  { loader = createKitGltfLoader(), fetchImpl = fetch as FetchLike } = {},
): Promise<LoadedKitModule> {
  const url = joinUrl(kitUrl, module.file);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`kit module ${url}: HTTP ${res.status}`);
  const gltf = await parseKitGlb(await res.arrayBuffer(), loader);
  const variants = kitVariants(gltf.scene);
  if (variants.size !== module.variants) {
    throw new Error(`${module.id}: manifest lists ${module.variants} variants, GLB has ${variants.size}`);
  }
  return { module, gltf, variants };
}
