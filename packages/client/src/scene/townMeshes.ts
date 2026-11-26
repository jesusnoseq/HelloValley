import { BufferAttribute, BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  assembleBuilding,
  buildingRecipe,
  type FlatTile,
  type Ground,
  isPlantModule,
  rotateVec,
  type StyleId,
  TERRAIN_TOP,
  TOWN_BUILDINGS,
  TOWN_D,
  TOWN_W,
  townRenderPlan,
  transformPoint,
  type Vec3,
} from "@hellovalley/shared";
import { type BuildingSign, placementMatrix } from "./buildingMeshes";
import type { KitGeometryPart, KitMaterialKind, LoadedKit } from "./kitLoader";
import { buildVegetation, disposeVegetation, type VegetationBatch } from "./vegetation";

/**
 * Town geometry (build plan M11): every static module of the town is transformed into the town
 * frame and merged by material slot inside a few spatial chunks, so the whole diorama costs a few
 * dozen draw calls (GDD §7.2: under 150) and the camera's frustum culling drops the chunks it
 * cannot see. The town comes in two layers: the style-neutral common kit (terrain, river, trees,
 * props), built once, and the style layer (buildings, street furniture and the props the style
 * dresses differently, shared/world/dressing.ts), rebuilt on a style switch without moving
 * anything.
 */

/** Chunk size in metres: 2 x 4 chunks over the 64 x 100 m town. */
export const TOWN_CHUNK_X = 32;
export const TOWN_CHUNK_Z = 25;

export function chunkOf(x: number, z: number): number {
  const cx = Math.min(Math.ceil(TOWN_W / TOWN_CHUNK_X) - 1, Math.max(0, Math.floor(x / TOWN_CHUNK_X)));
  const cz = Math.min(Math.ceil(TOWN_D / TOWN_CHUNK_Z) - 1, Math.max(0, Math.floor(z / TOWN_CHUNK_Z)));
  return cz * Math.ceil(TOWN_W / TOWN_CHUNK_X) + cx;
}

export interface TownMeshPart {
  /** The kit whose materials draw the part (the style layer also holds dressed common props). */
  kit: string;
  chunk: number;
  kind: KitMaterialKind;
  /** Ground pieces receive shadows but cast none, which keeps them out of the shadow pass. */
  ground: boolean;
  geometry: BufferGeometry;
}

/** Swaying canopies of one kit (its own atlas, so one batch per kit). */
export interface KitVegetation {
  kit: string;
  batch: VegetationBatch;
}

export interface TownLayer {
  kitId: string;
  parts: TownMeshPart[];
  /** Shop icons on hanging signs, in the town frame. */
  signs: BuildingSign[];
  triangles: number;
  /** The style layer's dressed plants (trees, pergolas), batched per kit to sway. */
  vegetation: KitVegetation[];
}

/**
 * The whole-town bucket (M37 draw-call pass): small material slots are not worth a mesh per chunk,
 * so they merge into one mesh for the whole town (one draw call, never culled, which costs little
 * at their size): glass and glow, the common layer's standing props (crates, rocks, trunks: ~5k
 * triangles) and the dressed props that come from the common kit (a swapped tree's trunk in
 * Europe, the square's fountain).
 */
export const WHOLE_TOWN_CHUNK = -1;
/** @deprecated M34 name of the whole-town bucket. */
export const DRESSING_CHUNK = WHOLE_TOWN_CHUNK;

/** Material slots merged into the whole-town bucket in every layer. */
const WHOLE_TOWN_KINDS: ReadonlySet<KitMaterialKind> = new Set(["glass", "glow"]);

/**
 * Whether a town part is drawn in the shadow pass: not the ground (it only receives), not the
 * water and not the glow (lamps and lit windows give light, they do not block it).
 */
export function castsShadow(part: Pick<TownMeshPart, "ground" | "kind">): boolean {
  return !part.ground && part.kind !== "water" && part.kind !== "glow";
}

class Buckets {
  private readonly map = new Map<string, { kit: string; chunk: number; kind: KitMaterialKind; ground: boolean; list: BufferGeometry[] }>();

  constructor(private readonly kit: string) {}

  add(chunk: number, kind: KitMaterialKind, ground: boolean, geometry: BufferGeometry, kit: string = this.kit): void {
    if (WHOLE_TOWN_KINDS.has(kind)) chunk = WHOLE_TOWN_CHUNK;
    const key = `${kit}:${chunk}:${kind}:${ground ? "g" : "o"}`;
    let bucket = this.map.get(key);
    if (!bucket) this.map.set(key, (bucket = { kit, chunk, kind, ground, list: [] }));
    bucket.list.push(geometry);
  }

  addParts(parts: readonly KitGeometryPart[], matrix: Matrix4, chunk: number, ground: boolean, kit: string = this.kit): void {
    for (const part of parts) this.add(chunk, part.kind, ground, part.geometry.clone().applyMatrix4(matrix), kit);
  }

  merge(label: string): { parts: TownMeshPart[]; triangles: number } {
    const parts: TownMeshPart[] = [];
    let triangles = 0;
    for (const { kit, chunk, kind, ground, list } of this.map.values()) {
      const geometry = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geometry) throw new Error(`${label}: could not merge chunk ${chunk} ${kind}`);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      triangles += (geometry.index?.count ?? 0) / 3;
      parts.push({ kit, chunk, kind, ground, geometry });
    }
    return { parts, triangles };
  }
}

const isGroundModule = (id: string) => id.startsWith("terrain.") || id.startsWith("bank.");

// ---------------------------------------------------------------------------------------------
// Flat tiles

/** Share of the atlas tile a flat quad spans (see sampleFlatSurface). */
export const FLAT_UV_INSET = 0.85;

/** How a flat ground quad is painted: corner UVs (front-left, front-right, back-left, back-right) and a colour. */
export interface FlatSample {
  kind: KitMaterialKind;
  uv: [number, number][];
  color: [number, number, number];
}

/**
 * Sample the flat top of a kit tile: the vertices on the plane `y` facing up give the colour
 * (their average) and the UV at each tile corner (the nearest one), so a two-triangle quad
 * matches the full kit tile minus its decorations. Null when the tile has no such surface.
 */
export function sampleFlatSurface(parts: readonly KitGeometryPart[], y: number, filter: (p: KitGeometryPart) => boolean = (p) => p.kind === "atlas"): FlatSample | null {
  const corners: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, -1],
    [1, -1],
  ];
  const best = corners.map(() => ({ d: Infinity, uv: [0, 0] as [number, number] }));
  const sum: [number, number, number] = [0, 0, 0];
  let n = 0;
  let kind: KitMaterialKind = "atlas";
  for (const part of parts) {
    if (!filter(part)) continue;
    const pos = part.geometry.getAttribute("position");
    const nor = part.geometry.getAttribute("normal");
    const uv = part.geometry.getAttribute("uv");
    const col = part.geometry.getAttribute("color");
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - y) > 0.004 || nor.getY(i) < 0.9) continue;
      kind = part.kind;
      n++;
      sum[0] += col.getX(i);
      sum[1] += col.getY(i);
      sum[2] += col.getZ(i);
      corners.forEach(([cx, cz], k) => {
        const d = Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz);
        if (d < best[k]!.d) best[k] = { d, uv: [uv.getX(i), uv.getY(i)] };
      });
    }
  }
  if (n === 0) return null;
  // Pull the corners a little towards the middle of the atlas tile: repeated per metre, the tile's
  // outermost texels (and mip bleed from its neighbours) would draw a grid on the ground.
  const mid = [0, 1].map((c) => best.reduce((a, b) => a + b.uv[c]!, 0) / best.length);
  const uv = best.map((b): [number, number] => [mid[0]! + (b.uv[0] - mid[0]!) * FLAT_UV_INSET, mid[1]! + (b.uv[1] - mid[1]!) * FLAT_UV_INSET]);
  return { kind, uv, color: [sum[0] / n, sum[1] / n, sum[2] / n] };
}

/** Where each ground's flat look comes from: the full kit tile, variant 0 (module frame heights). */
const FLAT_SOURCES: Readonly<Record<Exclude<Ground, "water">, string>> = {
  grass: "terrain.grass",
  path: "terrain.path",
  cobble: "terrain.cobble",
  sand: "terrain.sand",
};

export interface FlatSamples {
  ground: Record<Exclude<Ground, "water">, FlatSample>;
  water: FlatSample;
}

const FALLBACK: Record<string, [number, number, number]> = {
  grass: [0.34, 0.54, 0.2],
  path: [0.69, 0.53, 0.3],
  cobble: [0.5, 0.47, 0.4],
  sand: [0.86, 0.72, 0.4],
  water: [0.24, 0.52, 0.6],
};

function fallback(name: string, kind: KitMaterialKind = "atlas"): FlatSample {
  return { kind, uv: [[0, 0], [0, 0], [0, 0], [0, 0]], color: FALLBACK[name]! };
}

export async function sampleFlats(common: LoadedKit): Promise<FlatSamples> {
  const ground = {} as Record<Exclude<Ground, "water">, FlatSample>;
  for (const [g, id] of Object.entries(FLAT_SOURCES) as [Exclude<Ground, "water">, string][]) {
    ground[g] = (common.has(id) ? sampleFlatSurface(await common.variantParts(id, 0), TERRAIN_TOP[g]) : null) ?? fallback(g);
  }
  const water = common.has("bank.water") ? await common.variantParts("bank.water", 0) : [];
  const surface = sampleFlatSurface(water, TERRAIN_TOP.water, (p) => p.kind === "water") ?? fallback("water", "water");
  return { ground, water: { ...surface, kind: "water" } };
}

/** Two-triangle quads, one per flat tile, as plain geometry with the kit attribute layout. */
export function flatQuads(tiles: readonly { x: number; z: number; y: number; sample: FlatSample }[]): BufferGeometry {
  const n = tiles.length;
  const position = new Float32Array(n * 12);
  const normal = new Float32Array(n * 12);
  const uv = new Float32Array(n * 8);
  const color = new Float32Array(n * 12);
  const index = new Uint32Array(n * 6);
  tiles.forEach(({ x, z, y, sample }, t) => {
    // Front-left, front-right, back-left, back-right (front = +z).
    const xs = [x, x + 1, x, x + 1];
    const zs = [z + 1, z + 1, z, z];
    for (let k = 0; k < 4; k++) {
      const v = t * 4 + k;
      position.set([xs[k]!, y, zs[k]!], v * 3);
      normal.set([0, 1, 0], v * 3);
      uv.set(sample.uv[k]!, v * 2);
      color.set(sample.color, v * 3);
    }
    const b = t * 4;
    // Counter-clockwise seen from above (+y).
    index.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], t * 6);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(position, 3));
  g.setAttribute("normal", new BufferAttribute(normal, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  g.setAttribute("color", new BufferAttribute(color, 3));
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

function addFlats(buckets: Buckets, flats: readonly FlatTile[], samples: FlatSamples): void {
  const groups = new Map<string, { chunk: number; kind: KitMaterialKind; tiles: { x: number; z: number; y: number; sample: FlatSample }[] }>();
  const push = (chunk: number, sample: FlatSample, tile: { x: number; z: number; y: number }) => {
    const key = `${chunk}:${sample.kind}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { chunk, kind: sample.kind, tiles: [] }));
    g.tiles.push({ ...tile, sample });
  };
  for (const f of flats) {
    const chunk = chunkOf(f.x + 0.5, f.z + 0.5);
    // Water tiles are only their surface: the river material is opaque, so a bed under it would
    // never be seen (M37).
    push(chunk, f.ground === "water" ? samples.water : samples.ground[f.ground], f);
  }
  for (const { chunk, kind, tiles } of groups.values()) buckets.add(chunk, kind, true, flatQuads(tiles));
}

// ---------------------------------------------------------------------------------------------
// Layers

const matrixFor = (position: Vec3, rot: number, target = new Matrix4()) => placementMatrix({ position, rot, scale: [1, 1, 1] }, target);

/**
 * The style-neutral layer: flat ground, terrain and river pieces, bridge, dock, tree trunks and
 * props that look the same in every style. Plant canopies are not merged here: they sway in the
 * vegetation batch (scene/vegetation).
 */
export async function buildCommonLayer(common: LoadedKit): Promise<TownLayer> {
  const plan = townRenderPlan();
  const buckets = new Buckets(common.id);
  addFlats(buckets, plan.flats, await sampleFlats(common));
  const mods = plan.modules.filter((m) => m.kit === "common" && !m.dressed);
  const loaded = await Promise.all(mods.map(async (m) => ({ m, parts: await common.variantParts(m.module, m.variant) })));
  const matrix = new Matrix4();
  for (const { m, parts } of loaded) {
    const kept = isPlantModule(m.module) ? parts.filter((p) => p.kind !== "canopy") : parts;
    if (kept.length === 0) continue;
    matrixFor(m.position, m.rot, matrix);
    const ground = isGroundModule(m.module);
    // Ground stays chunked (it is most of the layer's triangles); standing props share one bucket.
    buckets.addParts(kept, matrix, ground ? chunkOf(m.position[0], m.position[2]) : WHOLE_TOWN_CHUNK, ground);
  }
  return { kitId: common.id, signs: [], vegetation: [], ...buckets.merge("common layer") };
}

/** A grass sample for batches without grass clusters (it is never read). */
const NO_GRASS = { uv: [] as [number, number][], color: [1, 1, 1] as [number, number, number] };

/**
 * The style layer: the ten assembled buildings, the style kit's street furniture and the props the
 * style dresses (dressing.ts: swapped trees, the bridge, lanterns, style-only decorations), drawn
 * from the style kit or the common kit. Their canopies sway in one vegetation batch per kit. The
 * dressing follows the kit that actually renders (`kit.id`), so a fallback kit shows its own town.
 */
export async function buildStyleLayer(kit: LoadedKit, common: LoadedKit): Promise<TownLayer> {
  const buckets = new Buckets(kit.id);
  const signs: BuildingSign[] = [];
  const building = new Matrix4();
  const local = new Matrix4();
  for (const b of TOWN_BUILDINGS) {
    const assembled = assembleBuilding(buildingRecipe(b.id), kit.manifest);
    const position: Vec3 = [b.at[0], 0, b.at[1]];
    matrixFor(position, b.rot, building);
    const area = assembled.bounds;
    const centre = transformPoint({ position, rot: b.rot, scale: [1, 1, 1] }, [(area.min[0] + area.max[0]) / 2, 0, (area.min[2] + area.max[2]) / 2]);
    const chunk = chunkOf(centre[0], centre[2]);
    const placed = await Promise.all(assembled.placements.map(async (p) => ({ p, parts: await kit.variantParts(p.module, p.variant) })));
    for (const { p, parts } of placed) {
      local.multiplyMatrices(building, placementMatrix(p));
      buckets.addParts(parts, local, chunk, false);
      if (!p.icon) continue;
      for (const s of kit.module(p.module).sockets) {
        if (s.name !== "icon" && s.name !== "icon_back") continue;
        const inBuilding = transformPoint(p, s.pos);
        signs.push({
          icon: p.icon,
          position: transformPoint({ position, rot: b.rot, scale: [1, 1, 1] }, inBuilding),
          normal: rotateVec(rotateVec(s.normal, p.rot), b.rot),
        });
      }
    }
  }
  const mods = townRenderPlan(kit.id as StyleId).modules.filter((m) => m.kit === "style" || m.dressed);
  const source = (m: (typeof mods)[number]) => (m.kit === "common" ? common : kit);
  const loaded = await Promise.all(mods.map(async (m) => ({ m, parts: await source(m).variantParts(m.module, m.variant) })));
  const matrix = new Matrix4();
  const plants = new Map<LoadedKit, typeof mods>();
  for (const { m, parts } of loaded) {
    const from = source(m);
    const kept = parts.filter((p) => p.kind !== "canopy");
    if (kept.length < parts.length) plants.set(from, [...(plants.get(from) ?? []), m]);
    matrixFor(m.position, m.rot, matrix);
    const chunk = from === kit ? chunkOf(m.position[0], m.position[2]) : WHOLE_TOWN_CHUNK;
    buckets.addParts(kept, matrix, chunk, false, from.id);
  }
  const vegetation: KitVegetation[] = [];
  for (const [from, list] of plants) vegetation.push({ kit: from.id, batch: await buildVegetation(from, NO_GRASS, list, []) });
  const merged = buckets.merge("style layer");
  return { kitId: kit.id, signs, vegetation, parts: merged.parts, triangles: merged.triangles + vegetation.reduce((n, v) => n + v.batch.triangles, 0) };
}

/**
 * Fetch and decode everything `buildStyleLayer` needs for a kit (every building module variant
 * and dressed prop), so a style switch afterwards only merges geometry: nothing waits on the
 * network (Settings preloads with this before applying a new style, M34).
 */
export async function warmStyleLayer(kit: LoadedKit, common: LoadedKit): Promise<void> {
  const wanted: Promise<unknown>[] = [];
  for (const b of TOWN_BUILDINGS) {
    for (const p of assembleBuilding(buildingRecipe(b.id), kit.manifest).placements) wanted.push(kit.variantParts(p.module, p.variant));
  }
  for (const m of townRenderPlan(kit.id as StyleId).modules) {
    if (m.kit === "style") wanted.push(kit.variantParts(m.module, m.variant));
    else if (m.dressed) wanted.push(common.variantParts(m.module, m.variant));
  }
  await Promise.all(wanted);
}

export function disposeTownLayer(layer: TownLayer): void {
  for (const p of layer.parts) p.geometry.dispose();
  for (const v of layer.vegetation) disposeVegetation(v.batch);
}
