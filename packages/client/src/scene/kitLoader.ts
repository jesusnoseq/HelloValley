import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { COMMON_KIT_ID, type KitId, type KitManifest, type KitModule, type StyleId } from "@hellovalley/shared";
import { createKitGltfLoader, fetchKitManifest, type FetchLike, loadKitModule, type LoadedKitModule } from "../assets/kitGlb";

/**
 * The style-aware kit loader (GDD §7.2): lazily fetches `kits/{kit}/kit-manifest.json`, the
 * shared atlas and each module GLB on first use, and caches the decoded geometry of every
 * module variant. Kits load once per page; switching the style loads the other kit next to the
 * cached one, so switching back is instant.
 */

/**
 * Style kits that exist so far: European (M05) and Mediterranean (M32). Arabic (M33) and
 * Japanese (M34) render with the European kit until theirs arrive. Add a style here when its
 * kit is committed under public/assets/kits/{style}/.
 */
export const AVAILABLE_STYLE_KITS: readonly StyleId[] = ["european", "mediterranean"];
export const FALLBACK_STYLE_KIT: StyleId = "european";

/** The kit that renders a style: its own when it exists, else the fallback. */
export function resolveKitStyle(style: StyleId): StyleId {
  return AVAILABLE_STYLE_KITS.includes(style) ? style : FALLBACK_STYLE_KIT;
}

/** Kits the town needs next to the style kit (the style-neutral terrain, river and plants). */
export const SHARED_KIT_IDS: readonly KitId[] = [COMMON_KIT_ID];

/**
 * Material slots of the generated kits, from the material extras the generator writes:
 * `atlas` (vertex colour x atlas), `canopy` (atlas; swayed in the town), `glass`, `glow` and `water`.
 */
export const KIT_MATERIAL_KINDS = ["atlas", "canopy", "glass", "glow", "water"] as const;
export type KitMaterialKind = (typeof KIT_MATERIAL_KINDS)[number];

export function materialKind(material: Material): KitMaterialKind {
  const extras = material.userData as Record<string, unknown>;
  if (extras.hv_canopy === true) return "canopy";
  if (extras.hv_water === true) return "water";
  if (extras.hv_glass === true) return "glass";
  if (extras.hv_glow === true) return "glow";
  return "atlas";
}

/** Emissive intensity of lamp lanterns at full night; above 1 so the bloom picks them up. */
export const LAMP_GLOW = 6;
/** Window glow at full night: lit rooms behind the glass, kept under the bloom threshold. */
export const WINDOW_GLOW = 0.8;

/** Lamp and window emission for a night-glow amount (0 by day, 1 at full night). */
export function kitGlow(nightGlow: number): { lamp: number; window: number } {
  return { lamp: 0.2 + LAMP_GLOW * nightGlow, window: WINDOW_GLOW * nightGlow };
}

/** One mesh of a module variant, in the module frame, with plain float attributes. */
export interface KitGeometryPart {
  kind: KitMaterialKind;
  geometry: BufferGeometry;
  /** `hv_part` of the node (`canopy`, `trunk`, `water`), or "". */
  part: string;
  /**
   * Origin of the node that carries `hv_part`, in the module frame (the mesh's own origin when
   * no ancestor does). For canopies it is the top of the trunk, the wind-sway pivot (M06).
   */
  pivot: [number, number, number];
}

/** The attribute layout every kit part is converted to, so parts of any module merge. */
export const KIT_GEOMETRY_ATTRIBUTES = { position: 3, normal: 3, uv: 2, color: 3 } as const;

/**
 * Copy a (possibly meshopt-quantized or interleaved) geometry into plain Float32 attributes
 * `position`, `normal`, `uv` and `color` (RGB), with an index, transformed by `matrix`.
 * Quantized attributes cannot take a transform in place, and merging needs identical layouts.
 */
export function normalizeKitGeometry(source: BufferGeometry, matrix?: Matrix4): BufferGeometry {
  const out = new BufferGeometry();
  const position = source.getAttribute("position");
  const count = position.count;
  for (const [name, size] of Object.entries(KIT_GEOMETRY_ATTRIBUTES)) {
    const attr = source.getAttribute(name);
    const data = new Float32Array(count * size);
    if (attr) {
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < size; c++) data[i * size + c] = attr.getComponent(i, c);
      }
    } else if (name === "color") {
      data.fill(1);
    }
    out.setAttribute(name, new BufferAttribute(data, size));
  }
  const index = source.getIndex();
  const indices = new Uint32Array(index ? index.count : count);
  for (let i = 0; i < indices.length; i++) indices[i] = index ? index.getX(i) : i;
  out.setIndex(new BufferAttribute(indices, 1));
  if (!source.getAttribute("normal")) out.computeVertexNormals();
  if (matrix) out.applyMatrix4(matrix);
  return out;
}

export interface KitLoaderOptions {
  /** Root that holds `assets/kits/` (default: Vite's BASE_URL). */
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /** Loads the atlas image; the default uses three's TextureLoader (needs a DOM). */
  loadTexture?: (url: string) => Promise<Texture>;
  gltfLoader?: GLTFLoader;
}

export function kitUrl(kit: KitId, baseUrl: string = import.meta.env.BASE_URL ?? "/"): string {
  return `${baseUrl.replace(/\/+$/, "")}/assets/kits/${kit}/`;
}

async function defaultLoadTexture(url: string): Promise<Texture> {
  return new TextureLoader().loadAsync(url);
}

/** A loaded kit: its manifest, one shared material per slot, and cached module variants. */
export class LoadedKit {
  readonly materials: Record<KitMaterialKind, MeshStandardMaterial>;
  private readonly modules = new Map<string, Promise<LoadedKitModule>>();
  private readonly variants = new Map<string, Promise<KitGeometryPart[]>>();
  private readonly byId: Map<string, KitModule>;

  constructor(
    readonly id: KitId,
    readonly url: string,
    readonly manifest: KitManifest,
    readonly atlas: Texture | null,
    private readonly options: { fetchImpl: FetchLike; gltfLoader: GLTFLoader },
  ) {
    this.byId = new Map(manifest.modules.map((m) => [m.id, m]));
    const base = { vertexColors: true, roughness: 0.9, metalness: 0 };
    const atlasMaterial = (name: string) => new MeshStandardMaterial({ ...base, name, map: atlas });
    this.materials = {
      atlas: atlasMaterial(`${id}.atlas`),
      // Plain fallbacks for galleries; the town draws canopies with the sway material
      // (scene/vegetation.ts) and water with the river shader (scene/riverMaterial.ts).
      canopy: atlasMaterial(`${id}.canopy`),
      water: new MeshStandardMaterial({ ...base, name: `${id}.water`, roughness: 0.3 }),
      glass: new MeshStandardMaterial({ ...base, name: `${id}.glass`, roughness: 0.25, emissive: new Color("#ffc977"), emissiveIntensity: 0 }),
      glow: new MeshStandardMaterial({ ...base, name: `${id}.glow`, roughness: 0.5, emissive: new Color("#ffc46b"), emissiveIntensity: 0.2 }),
    };
  }

  module(id: string): KitModule {
    const m = this.byId.get(id);
    if (!m) throw new Error(`kit ${this.id} has no module ${id}`);
    return m;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The decoded GLB of a module (fetched once). */
  loadModule(id: string): Promise<LoadedKitModule> {
    let p = this.modules.get(id);
    if (!p) {
      p = loadKitModule(this.url, this.module(id), { loader: this.options.gltfLoader, fetchImpl: this.options.fetchImpl });
      this.modules.set(id, p);
      p.catch(() => this.modules.delete(id));
    }
    return p;
  }

  /**
   * The meshes of one variant in the module frame (node transforms baked in), cached. The
   * geometries are shared: callers clone or transform copies, never the cached ones.
   */
  variantParts(id: string, variant: number): Promise<KitGeometryPart[]> {
    const index = variant % this.module(id).variants;
    const key = `${id}#${index}`;
    let p = this.variants.get(key);
    if (!p) {
      p = this.loadModule(id).then(({ gltf, variants }) => {
        const root = variants.get(index);
        if (!root) throw new Error(`${id} has no variant ${index}`);
        gltf.scene.updateMatrixWorld(true);
        const parts: KitGeometryPart[] = [];
        root.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          const material = (Array.isArray(node.material) ? node.material[0] : node.material) as Material;
          let part = "";
          let owner: Object3D = node;
          for (let n: Object3D | null = node; n; n = n.parent) {
            if (typeof n.userData.hv_part === "string") {
              part = n.userData.hv_part;
              owner = n;
              break;
            }
          }
          const origin = new Vector3().setFromMatrixPosition(owner.matrixWorld);
          parts.push({ kind: materialKind(material), part, pivot: [origin.x, origin.y, origin.z], geometry: normalizeKitGeometry(node.geometry, node.matrixWorld) });
        });
        return parts;
      });
      this.variants.set(key, p);
      p.catch(() => this.variants.delete(key));
    }
    return p;
  }

  /** Load several modules in parallel (all their GLBs). */
  async preload(ids: Iterable<string>): Promise<void> {
    await Promise.all([...new Set(ids)].map((id) => this.loadModule(id)));
  }
}

export interface KitLoader {
  load(kit: KitId): Promise<LoadedKit>;
  /** The kit that renders a style (with the fallback for styles without a kit yet). */
  loadStyle(style: StyleId): Promise<LoadedKit>;
  /** Kits whose load finished, for per-frame material updates. */
  loaded(): LoadedKit[];
}

export function createKitLoader(options: KitLoaderOptions = {}): KitLoader {
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url));
  const loadTexture = options.loadTexture ?? defaultLoadTexture;
  const gltfLoader = options.gltfLoader ?? createKitGltfLoader();
  const cache = new Map<KitId, Promise<LoadedKit>>();
  const done = new Map<KitId, LoadedKit>();

  async function loadKit(id: KitId): Promise<LoadedKit> {
    const url = kitUrl(id, options.baseUrl);
    const manifest = await fetchKitManifest(url, fetchImpl);
    if (manifest.style !== id) throw new Error(`kit ${id}: manifest says ${manifest.style}`);
    let atlas: Texture | null = null;
    if (manifest.atlas) {
      if (manifest.atlas.file.endsWith(".ktx2")) {
        // TODO(M37): KTX2Loader with the Basis transcoder once the pipeline ships KTX2 atlases.
        throw new Error(`kit ${id}: KTX2 atlases are not supported yet (${manifest.atlas.file})`);
      }
      atlas = await loadTexture(`${url}${manifest.atlas.file}`);
      // glTF UVs have their origin at the top left; the manifest rects are in glTF space.
      atlas.flipY = false;
      atlas.colorSpace = SRGBColorSpace;
      atlas.needsUpdate = true;
    }
    const kit = new LoadedKit(id, url, manifest, atlas, { fetchImpl, gltfLoader });
    done.set(id, kit);
    return kit;
  }

  return {
    load(id) {
      let p = cache.get(id);
      if (!p) {
        p = loadKit(id);
        cache.set(id, p);
        p.catch(() => cache.delete(id));
      }
      return p;
    },
    loadStyle(style) {
      return this.load(resolveKitStyle(style));
    },
    loaded: () => [...done.values()],
  };
}

/** The page-wide loader. */
export const kitLoader: KitLoader = createKitLoader();
