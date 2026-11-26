import { BatchedMesh, BufferAttribute, BufferGeometry, type Material, Matrix4, MeshDepthMaterial, MeshStandardMaterial, Quaternion, type Texture, Vector3, type WebGLProgramParametersWithUniforms } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GRASS_TUFT_VARIANTS, type GrassTuft, isPlantModule, townGrassTufts, townRenderPlan, type TownModulePlacement } from "@hellovalley/shared";
import { placementMatrix } from "./buildingMeshes";
import type { KitGeometryPart, LoadedKit } from "./kitLoader";
import type { FlatSample } from "./townMeshes";
import { worldUniforms } from "./worldFx";

/**
 * Swaying vegetation (GDD §7.1, build plan M12): every tree canopy, bush, flower bed and grass
 * cluster of the town in one BatchedMesh (one draw call, plus one in the shadow pass), with
 * per-instance frustum culling. A vertex shader bends each instance in the wind around its pivot.
 * The trunks do not move and stay merged in the static town chunks.
 *
 * Each geometry carries a `sway` attribute: how far a vertex moves per unit of wind, which is its
 * height above the pivot (the top of the trunk for canopies, M06) times a flexibility per kind.
 */

/** Flexibility per kind of plant: grass bends much more than a tree crown. */
export const SWAY_FLEX = { tree: 1, bush: 1.6, flowers: 2.6, grass: 4 } as const;

export function swayFlexFor(module: string): number {
  // The pergola's vine sits on rafters: it moves like a crown, not like a flower bed.
  if (module.startsWith("tree.") || module === "pergola") return SWAY_FLEX.tree;
  if (module === "bush" || module === "bougainvillea") return SWAY_FLEX.bush;
  return SWAY_FLEX.flowers;
}

/** How much of the counter-swing parts below the pivot get (a canopy bends, it does not pivot). */
export const BELOW_PIVOT_SWAY = 0.25;

/**
 * The `sway` attribute of a geometry: flex x (height above the pivot). Below the pivot (low
 * conifer branches) it swings the other way, but only a quarter as much.
 */
export function swayValues(positions: ArrayLike<number>, pivotY: number, flex: number): Float32Array {
  const out = new Float32Array(positions.length / 3);
  for (let i = 0; i < out.length; i++) {
    const d = positions[i * 3 + 1]! - pivotY;
    out[i] = flex * (d >= 0 ? d : d * BELOW_PIVOT_SWAY);
  }
  return out;
}

function withSway(geometry: BufferGeometry, pivotY: number, flex: number): BufferGeometry {
  geometry.setAttribute("sway", new BufferAttribute(swayValues(geometry.getAttribute("position").array, pivotY, flex), 1));
  return geometry;
}

/** The canopy meshes of one plant variant merged into one geometry with its sway attribute. */
export function canopyGeometry(parts: readonly KitGeometryPart[], flex: number): BufferGeometry | null {
  const canopies = parts.filter((p) => p.kind === "canopy").map((p) => withSway(p.geometry.clone(), p.pivot[1], flex));
  if (canopies.length === 0) return null;
  const merged = canopies.length === 1 ? canopies[0]! : mergeGeometries(canopies, false);
  if (canopies.length > 1) for (const g of canopies) g.dispose();
  return merged;
}

// ---------------------------------------------------------------------------------------------
// Grass clusters

const BLOOMS: readonly ([number, number, number] | null)[] = [null, null, [0.98, 0.62, 0.72], [1, 0.86, 0.45]];

/**
 * A small grass cluster: a handful of single-triangle blades leaning outwards (both windings, so
 * no double-sided material is needed), and on the blooming variants a tiny flower head. Painted
 * with the grass tile's atlas UV and colour so it matches the ground. 8–14 triangles.
 */
export function grassTuftGeometry(variant: number, grass: Pick<FlatSample, "uv" | "color">): BufferGeometry {
  const v = ((variant % GRASS_TUFT_VARIANTS) + GRASS_TUFT_VARIANTS) % GRASS_TUFT_VARIANTS;
  const blades = v === 1 ? 5 : 4;
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const uv = grass.uv.reduce<[number, number]>((a, b) => [a[0] + b[0] / grass.uv.length, a[1] + b[1] / grass.uv.length], [0, 0]);
  const tint = (k: number): [number, number, number] => [grass.color[0] * k, grass.color[1] * k, grass.color[2] * k];
  const tri = (a: number[], b: number[], c: number[], n: number[], ca: number[], cb: number[], cc: number[]) => {
    // Front and back windings with the same soft, mostly-up normal (foliage lighting).
    for (const order of [[a, b, c, ca, cb, cc], [a, c, b, ca, cc, cb]] as const) {
      const base = position.length / 3;
      position.push(...order[0], ...order[1], ...order[2]);
      color.push(...order[3], ...order[4], ...order[5]);
      for (let k = 0; k < 3; k++) normal.push(...n);
      index.push(base, base + 1, base + 2);
    }
  };
  for (let b = 0; b < blades; b++) {
    const angle = (b / blades) * Math.PI * 2 + v * 0.7;
    const [dx, dz] = [Math.cos(angle), Math.sin(angle)];
    const h = (v === 1 ? 0.2 : 0.26) * (0.8 + 0.4 * (((b * 7 + v * 3) % 5) / 4));
    const r = 0.035;
    const lean = 0.07;
    // Base edge perpendicular to the lean direction.
    const a = [dx * r * 0.5 - dz * 0.03, 0, dz * r * 0.5 + dx * 0.03];
    const c = [dx * r * 0.5 + dz * 0.03, 0, dz * r * 0.5 - dx * 0.03];
    const tip = [dx * (r + lean), h, dz * (r + lean)];
    const n = new Vector3(dx * 0.35, 1, dz * 0.35).normalize().toArray();
    tri(a, tip, c, n, tint(0.62), tint(1.3), tint(0.62));
  }
  const bloom = BLOOMS[v];
  if (bloom) {
    // Two crossed petals on a short stalk-free head, sitting just above the blades.
    const y = 0.24;
    const s = 0.04;
    const up = [0, 1, 0];
    tri([-s, y, 0], [0, y + s * 1.4, 0], [s, y, 0], up, bloom, bloom, bloom);
    tri([0, y, -s], [0, y + s * 1.4, 0], [0, y, s], up, bloom, bloom, bloom);
  }
  const count = position.length / 3;
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(Array.from({ length: count }, () => uv).flat()), 2));
  g.setAttribute("color", new BufferAttribute(new Float32Array(color), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  return withSway(g, 0, SWAY_FLEX.grass);
}

// ---------------------------------------------------------------------------------------------
// The batch

export interface VegetationGeometry {
  /** `module#variant` or `grass#variant`. */
  key: string;
  geometry: BufferGeometry;
}

export interface VegetationInstance {
  geometry: number;
  matrix: Matrix4;
}

export interface VegetationBatch {
  geometries: VegetationGeometry[];
  instances: VegetationInstance[];
  /** Triangles of every instance (what the batch draws with nothing culled). */
  triangles: number;
  vertexCount: number;
  indexCount: number;
}

const tris = (g: BufferGeometry) => (g.index?.count ?? 0) / 3;

/** Model matrix of a grass cluster. */
export function tuftMatrix(t: GrassTuft, target = new Matrix4()): Matrix4 {
  return target.compose(new Vector3(t.x, 0, t.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), t.yaw), new Vector3(t.scale, t.scale, t.scale));
}

/**
 * Collect the town's swaying vegetation: the canopies of every plant module of the render plan
 * and the shared grass clusters, one geometry per module variant / tuft look. By default the
 * style-neutral plants (the same in every style); the style layer batches its dressed plants
 * itself (townMeshes.ts).
 */
export async function buildVegetation(
  common: LoadedKit,
  grass: Pick<FlatSample, "uv" | "color">,
  plants: readonly TownModulePlacement[] = townRenderPlan().modules.filter((m) => m.kit === "common" && !m.dressed && isPlantModule(m.module)),
  tufts: readonly GrassTuft[] = townGrassTufts(),
): Promise<VegetationBatch> {
  const geometries: VegetationGeometry[] = [];
  const ids = new Map<string, number>();
  const instances: VegetationInstance[] = [];
  for (const m of plants) {
    const variant = m.variant % common.module(m.module).variants;
    const key = `${m.module}#${variant}`;
    let id = ids.get(key);
    if (id === undefined) {
      const geometry = canopyGeometry(await common.variantParts(m.module, variant), swayFlexFor(m.module));
      if (!geometry) continue;
      id = geometries.push({ key, geometry }) - 1;
      ids.set(key, id);
    }
    instances.push({ geometry: id, matrix: placementMatrix({ position: m.position, rot: m.rot, scale: [1, 1, 1] }) });
  }
  for (const t of tufts) {
    const key = `grass#${t.variant}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = geometries.push({ key, geometry: grassTuftGeometry(t.variant, grass) }) - 1;
      ids.set(key, id);
    }
    instances.push({ geometry: id, matrix: tuftMatrix(t) });
  }
  let triangles = 0;
  for (const i of instances) triangles += tris(geometries[i.geometry]!.geometry);
  const vertexCount = geometries.reduce((n, g) => n + g.geometry.getAttribute("position").count, 0);
  const indexCount = geometries.reduce((n, g) => n + (g.geometry.index?.count ?? 0), 0);
  return { geometries, instances, triangles, vertexCount, indexCount };
}

export function disposeVegetation(batch: VegetationBatch): void {
  for (const g of batch.geometries) g.geometry.dispose();
}

// ---------------------------------------------------------------------------------------------
// Sway shader

/**
 * GLSL injected after `#include <begin_vertex>`: bend the vertex by the wind times its `sway`.
 * The wind is in the town frame, so it is turned into the instance's local frame with the
 * (rotation and uniform scale only) batching matrix. Each instance gets its own phase from its
 * position, and two sines plus a slow gust keep the motion from looking mechanical.
 */
export const SWAY_VERTEX = /* glsl */ `
  #ifdef USE_BATCHING
    mat4 hvInstance = batchingMatrix;
  #else
    mat4 hvInstance = mat4(1.0);
  #endif
  vec3 hvRoot = (modelMatrix * hvInstance * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float hvPhase = dot(hvRoot.xz, vec2(0.37, 0.23));
  float hvGust = 0.65 + 0.35 * sin(uHvTime * 0.45 + hvRoot.x * 0.05);
  float hvWave = 0.55 + 0.45 * sin(uHvTime * 1.7 + hvPhase) + 0.2 * sin(uHvTime * 3.3 + hvPhase * 1.9 + transformed.y * 2.0);
  vec2 hvWind = uHvWind * hvWave * hvGust;
  mat3 hvTurn = mat3(hvInstance);
  float hvScale = max(length(hvTurn[0]), 1e-4);
  vec3 hvLocal = transpose(hvTurn) * vec3(hvWind.x, 0.0, hvWind.y) / (hvScale * hvScale);
  transformed += hvLocal * sway;
`;

const SWAY_PARS = /* glsl */ `
  attribute float sway;
  uniform float uHvTime;
  uniform vec2 uHvWind;
`;

function patchSway(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uHvTime = worldUniforms.uHvTime;
  shader.uniforms.uHvWind = worldUniforms.uHvWind;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${SWAY_PARS}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>\n${SWAY_VERTEX}`);
}

function withSwayShader<M extends Material>(material: M): M {
  material.onBeforeCompile = patchSway;
  material.customProgramCacheKey = () => "hv-sway";
  return material;
}

/** The canopy material with wind sway (atlas x vertex colour, like the kit's canopy slot). */
export function createSwayMaterial(atlas: Texture | null): MeshStandardMaterial {
  return withSwayShader(new MeshStandardMaterial({ name: "vegetation.sway", vertexColors: true, map: atlas, roughness: 0.9, metalness: 0 }));
}

/** Shadow-pass material that sways the same way, so shadows move with the leaves. */
export function createSwayDepthMaterial(): MeshDepthMaterial {
  return withSwayShader(new MeshDepthMaterial());
}

/** The BatchedMesh that draws a vegetation batch. The batch geometries can be disposed after. */
export function createVegetationMesh(batch: VegetationBatch, material: Material): BatchedMesh {
  const mesh = new BatchedMesh(Math.max(1, batch.instances.length), Math.max(1, batch.vertexCount), Math.max(1, batch.indexCount), material);
  mesh.name = "vegetation";
  const ids = batch.geometries.map((g) => mesh.addGeometry(g.geometry));
  for (const i of batch.instances) mesh.setMatrixAt(mesh.addInstance(ids[i.geometry]!), i.matrix);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = createSwayDepthMaterial();
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
