import { BufferAttribute, BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  assembleBuilding,
  buildingRecipe,
  type FlatTile,
  type Ground,
  RIVER_BED_Y,
  rotateVec,
  TERRAIN_TOP,
  TERRAIN_Y,
  TOWN_BUILDINGS,
  TOWN_D,
  TOWN_W,
  townRenderPlan,
  transformPoint,
  type Vec3,
} from "@hellovalley/shared";
import { type BuildingSign, placementMatrix } from "./buildingMeshes";
import type { KitGeometryPart, KitMaterialKind, LoadedKit } from "./kitLoader";

/**
 * Town geometry (build plan M11): every static module of the town is transformed into the town
 * frame and merged by material slot inside a few spatial chunks, so the whole diorama costs a few
 * dozen draw calls (GDD §7.2: under 150) and the camera's frustum culling drops the chunks it
 * cannot see. The town comes in two layers: the style-neutral common kit (terrain, river, trees,
 * props), built once, and the style kit (buildings and street furniture), rebuilt on a style
 * switch without moving anything.
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
  chunk: number;
  kind: KitMaterialKind;
  /** Ground pieces receive shadows but cast none, which keeps them out of the shadow pass. */
  ground: boolean;
  geometry: BufferGeometry;
}

export interface TownLayer {
  kitId: string;
  parts: TownMeshPart[];
  /** Shop icons on hanging signs, in the town frame. */
  signs: BuildingSign[];
  triangles: number;
}

class Buckets {
  private readonly map = new Map<string, { chunk: number; kind: KitMaterialKind; ground: boolean; list: BufferGeometry[] }>();

  add(chunk: number, kind: KitMaterialKind, ground: boolean, geometry: BufferGeometry): void {
    const key = `${chunk}:${kind}:${ground ? "g" : "o"}`;
    let bucket = this.map.get(key);
    if (!bucket) this.map.set(key, (bucket = { chunk, kind, ground, list: [] }));
    bucket.list.push(geometry);
  }

  addParts(parts: readonly KitGeometryPart[], matrix: Matrix4, chunk: number, ground: boolean): void {
    for (const part of parts) this.add(chunk, part.kind, ground, part.geometry.clone().applyMatrix4(matrix));
  }

  merge(label: string): { parts: TownMeshPart[]; triangles: number } {
    const parts: TownMeshPart[] = [];
    let triangles = 0;
    for (const { chunk, kind, ground, list } of this.map.values()) {
      const geometry = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geometry) throw new Error(`${label}: could not merge chunk ${chunk} ${kind}`);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      triangles += (geometry.index?.count ?? 0) / 3;
      parts.push({ chunk, kind, ground, geometry });
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
  bed: FlatSample;
  water: FlatSample;
}

const FALLBACK: Record<string, [number, number, number]> = {
  grass: [0.34, 0.54, 0.2],
  path: [0.69, 0.53, 0.3],
  cobble: [0.5, 0.47, 0.4],
  sand: [0.86, 0.72, 0.4],
  bed: [0.26, 0.32, 0.27],
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
  const bed = sampleFlatSurface(water, RIVER_BED_Y, (p) => p.kind === "atlas" && p.part !== "water") ?? fallback("bed");
  const surface = sampleFlatSurface(water, TERRAIN_TOP.water, (p) => p.kind === "water") ?? fallback("water", "water");
  return { ground, bed, water: { ...surface, kind: "water" } };
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
    if (f.ground === "water") {
      push(chunk, samples.water, f);
      push(chunk, samples.bed, { x: f.x, z: f.z, y: TERRAIN_Y + RIVER_BED_Y });
    } else {
      push(chunk, samples.ground[f.ground], f);
    }
  }
  for (const { chunk, kind, tiles } of groups.values()) buckets.add(chunk, kind, true, flatQuads(tiles));
}

// ---------------------------------------------------------------------------------------------
// Layers

const matrixFor = (position: Vec3, rot: number, target = new Matrix4()) => placementMatrix({ position, rot, scale: [1, 1, 1] }, target);

/** The style-neutral layer: flat ground, terrain and river pieces, bridge, dock, trees and props. */
export async function buildCommonLayer(common: LoadedKit): Promise<TownLayer> {
  const plan = townRenderPlan();
  const buckets = new Buckets();
  addFlats(buckets, plan.flats, await sampleFlats(common));
  const mods = plan.modules.filter((m) => m.kit === "common");
  const loaded = await Promise.all(mods.map(async (m) => ({ m, parts: await common.variantParts(m.module, m.variant) })));
  const matrix = new Matrix4();
  for (const { m, parts } of loaded) {
    matrixFor(m.position, m.rot, matrix);
    buckets.addParts(parts, matrix, chunkOf(m.position[0], m.position[2]), isGroundModule(m.module));
  }
  return { kitId: common.id, signs: [], ...buckets.merge("common layer") };
}

/** The style layer: the ten assembled buildings and the style kit's street furniture. */
export async function buildStyleLayer(kit: LoadedKit): Promise<TownLayer> {
  const buckets = new Buckets();
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
  const mods = townRenderPlan().modules.filter((m) => m.kit === "style");
  const loaded = await Promise.all(mods.map(async (m) => ({ m, parts: await kit.variantParts(m.module, m.variant) })));
  const matrix = new Matrix4();
  for (const { m, parts } of loaded) {
    matrixFor(m.position, m.rot, matrix);
    buckets.addParts(parts, matrix, chunkOf(m.position[0], m.position[2]), false);
  }
  return { kitId: kit.id, signs, ...buckets.merge("style layer") };
}

export function disposeTownLayer(layer: TownLayer): void {
  for (const p of layer.parts) p.geometry.dispose();
}
