/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box3, Frustum, Matrix4, OrthographicCamera, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { difficultySigns, isPlantModule, SPAWN_POINT, TERRAIN_TOP, TERRAIN_Y, TOWN_BOUNDS, TOWN_CENTER, TOWN_D, TOWN_W, townGrassTufts, townPlaces, townRenderPlan } from "@hellovalley/shared";
import { CAMERA_PITCH_DEG, cameraOffset, degToRad, yawForStep, ZOOM_LEVELS } from "./cameraMath";
import { leafOffsets } from "./DifficultySigns";
import { DRAW_CALL_BUDGET, estimateDrawCalls } from "./drawCalls";
import { createKitLoader } from "./kitLoader";
import { playerDrawItems } from "./playerDraw";
import { baseWallsGeometry, townDrawItems } from "./Town";
import { OVERVIEW_VIEW_HEIGHT, SPAWN_TARGET } from "./townCamera";
import { buildCommonLayer, buildStyleLayer, chunkOf, flatQuads, sampleFlats, TOWN_CHUNK_X, TOWN_CHUNK_Z, type TownLayer } from "./townMeshes";
import { buildVegetation, disposeVegetation } from "./vegetation";

const PUBLIC = new URL("../../public/", import.meta.url);
const present = ["common", "european"].every((k) => existsSync(fileURLToPath(new URL(`assets/kits/${k}/kit-manifest.json`, PUBLIC))));

function fetchFromPublic(url: string) {
  const file = fileURLToPath(new URL(url.replace(/^\//, ""), PUBLIC));
  const ok = existsSync(file);
  const bytes = ok ? readFileSync(file) : Buffer.alloc(0);
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(JSON.parse(bytes.toString("utf8"))),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
  });
}

const loader = createKitLoader({ baseUrl: "/", fetchImpl: fetchFromPublic, loadTexture: () => Promise.resolve(new Texture()) });

/** Triangles and meshes a 16:9 orthographic view at `viewHeight` around `target` would draw. */
function onScreen(layers: readonly TownLayer[], target: [number, number], viewHeight: number, step = 0): { triangles: number; meshes: number } {
  const aspect = 16 / 9;
  const camera = new OrthographicCamera((-viewHeight * aspect) / 2, (viewHeight * aspect) / 2, viewHeight / 2, -viewHeight / 2, 0.1, 200);
  const [ox, oy, oz] = cameraOffset(yawForStep(step), degToRad(CAMERA_PITCH_DEG));
  camera.position.set(target[0] + ox, oy, target[1] + oz);
  camera.lookAt(target[0], 0, target[1]);
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  let triangles = 0;
  let meshes = 0;
  for (const layer of layers) {
    for (const part of layer.parts) {
      if (!frustum.intersectsBox(part.geometry.boundingBox!)) continue;
      meshes++;
      triangles += (part.geometry.index?.count ?? 0) / 3;
    }
  }
  return { triangles, meshes };
}

describe("town scene helpers", () => {
  it("aims the main scene's camera at the shared spawn point", () => {
    expect([SPAWN_TARGET[0], SPAWN_TARGET[2]]).toEqual(SPAWN_POINT);
  });

  it("splits the town into chunks", () => {
    expect(chunkOf(0, 0)).toBe(0);
    expect(chunkOf(TOWN_CHUNK_X + 1, 0)).toBe(1);
    expect(chunkOf(0, TOWN_CHUNK_Z + 1)).toBe(2);
    expect(chunkOf(TOWN_W + 5, TOWN_D + 5)).toBe(chunkOf(TOWN_W - 1, TOWN_D - 1));
    expect(chunkOf(-3, -3)).toBe(0);
  });

  it("builds flat quads facing up with the sampled paint", () => {
    const sample = { kind: "atlas" as const, uv: [[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][], color: [0.5, 0.6, 0.7] as [number, number, number] };
    const g = flatQuads([{ x: 2, z: 3, y: 0, sample }]);
    expect(g.index!.count).toBe(6);
    g.computeVertexNormals();
    expect(g.getAttribute("normal").getY(0)).toBeCloseTo(1);
    expect(g.getAttribute("color").getZ(3)).toBeCloseTo(0.7);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.toArray()).toEqual([2, 0, 3]);
    expect(g.boundingBox!.max.toArray()).toEqual([3, 0, 4]);
  });

  it("walls the diorama base on all four sides, facing out", () => {
    const g = baseWallsGeometry();
    expect(g.index!.count).toBe(24);
    const before = g.getAttribute("normal").array.slice();
    g.computeVertexNormals();
    expect(Array.from(g.getAttribute("normal").array).map((v) => Math.round(v) + 0)).toEqual(Array.from(before));
    g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBe(TOWN_BOUNDS[0]);
    expect(g.boundingBox!.max.z).toBe(TOWN_BOUNDS[3]);
  });

  it("centres the leaves on the difficulty boards", () => {
    expect(leafOffsets(1)).toEqual([0]);
    expect(leafOffsets(5).reduce((a, b) => a + b, 0)).toBeCloseTo(0);
    expect(difficultySigns().map((s) => s.leaves)).toContain(5);
  });

  it("fits the whole town in the overview", () => {
    // The town's half-diagonal fits the shorter (vertical) half of the view at every facing.
    const halfDiagonal = Math.hypot(TOWN_W / 2, TOWN_D / 2);
    expect(OVERVIEW_VIEW_HEIGHT / 2).toBeGreaterThan(halfDiagonal * Math.sin(degToRad(CAMERA_PITCH_DEG)) + 3);
    expect(TOWN_CENTER).toEqual([TOWN_W / 2, TOWN_D / 2]);
  });
});

describe.skipIf(!present)("town meshes (common + europe kits)", () => {
  it("paints flat tiles like the kit tiles they stand in for", async () => {
    const common = await loader.load("common");
    const samples = await sampleFlats(common);
    for (const s of Object.values(samples.ground)) {
      expect(s.kind).toBe("atlas");
      // Real UVs inside the atlas, not the all-zero fallback.
      expect(s.uv.some(([u, v]) => u > 0 && v > 0)).toBe(true);
    }
    expect(samples.water.kind).toBe("water");
    expect(samples.bed.uv.some(([u]) => u > 0)).toBe(true);
    expect(samples.ground.grass.color[1]).toBeGreaterThan(samples.ground.grass.color[0]);
  });

  it("merges the town into a few chunked meshes within the GDD budget", async () => {
    const kit = await loader.load("common");
    const common = await buildCommonLayer(kit);
    const style = await buildStyleLayer(await loader.loadStyle("european"));
    const vegetation = await buildVegetation(kit, (await sampleFlats(kit)).ground.grass);
    const meshes = common.parts.length + style.parts.length;
    // Everything the town draws: merged chunks plus the instanced vegetation (canopies and grass).
    const triangles = common.triangles + style.triangles + vegetation.triangles;
    // GDD §7.2: under 300k triangles and 150 draw calls for the whole town.
    expect(triangles).toBeLessThan(300_000);
    expect(meshes).toBeLessThan(60);
    // Ground meshes do not cast shadows; canopies left the chunks for the sway batch.
    expect(common.parts.some((p) => p.ground)).toBe(true);
    expect(common.parts.some((p) => p.kind === "canopy")).toBe(false);
    expect(common.parts.some((p) => p.kind === "water")).toBe(true);
    // Every merged part sits inside the diorama (plus overhangs) and on or under the ground plane.
    const box = new Box3();
    for (const p of [...common.parts, ...style.parts]) box.union(p.geometry.boundingBox!);
    expect(box.min.x).toBeGreaterThan(-1);
    expect(box.max.x).toBeLessThan(TOWN_W + 1);
    expect(box.min.y).toBeGreaterThanOrEqual(TERRAIN_Y + -0.5 - 1e-3);
    expect(TERRAIN_Y + TERRAIN_TOP.grass).toBeCloseTo(0);
    // Ten buildings' hanging signs, both faces.
    expect(style.signs.length).toBeGreaterThan(0);
    expect(style.signs.length % 2).toBe(0);

    // What gameplay views draw: the far zoom around the spawn point and the square (the
    // vegetation batch counted whole, as if none of it were culled).
    const far = ZOOM_LEVELS.at(-1)!.viewHeight;
    for (const [label, target] of [
      ["spawn", SPAWN_POINT],
      ["square", townPlaces().town_square],
      ["bridge", townPlaces().bridge],
    ] as const) {
      for (const step of [0, 1, 2, 3]) {
        const view = onScreen([common, style], [target[0], target[1]], far, step);
        expect(view.triangles + vegetation.triangles, `${label} step ${step}`).toBeLessThan(300_000);
        expect(view.meshes).toBeLessThanOrEqual(meshes);
      }
    }
    // The overview sees everything.
    const all = onScreen([common, style], TOWN_CENTER, OVERVIEW_VIEW_HEIGHT);
    expect(all.meshes).toBe(meshes);

    // Draw calls, upper bound: every mesh in view, every caster in the shadow camera, the post
    // stack, and the local player's avatar and click marker (M13).
    const calls = estimateDrawCalls([...townDrawItems(common, style, vegetation), ...playerDrawItems()]);
    expect(calls.total, JSON.stringify(calls)).toBeLessThan(DRAW_CALL_BUDGET);
    for (const p of [...common.parts, ...style.parts]) p.geometry.dispose();
    disposeVegetation(vegetation);
  });

  it("batches every plant canopy and grass cluster with a sway weight", async () => {
    const kit = await loader.load("common");
    const vegetation = await buildVegetation(kit, (await sampleFlats(kit)).ground.grass);
    const plants = townRenderPlan().modules.filter((m) => m.kit === "common" && isPlantModule(m.module));
    expect(vegetation.instances.length).toBe(plants.length + townGrassTufts().length);
    // One geometry per plant variant and grass look, shared by all their instances.
    expect(vegetation.geometries.length).toBeLessThan(25);
    for (const { key, geometry } of vegetation.geometries) {
      const sway = geometry.getAttribute("sway");
      expect(sway, key).toBeDefined();
      const pos = geometry.getAttribute("position");
      let top = -Infinity;
      let topSway = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > top) {
          top = pos.getY(i);
          topSway = sway.getX(i);
        }
      }
      // The top of every canopy moves with the wind; tree canopies pivot on the trunk top.
      expect(topSway, key).toBeGreaterThan(0.2);
      if (key.startsWith("tree.")) expect(Math.min(...Array.from(sway.array as Float32Array)), key).toBeGreaterThan(-0.5);
    }
    // Trunks stay in the static chunks.
    const common = await buildCommonLayer(kit);
    expect(common.parts.some((p) => p.kind === "atlas" && !p.ground)).toBe(true);
    for (const p of common.parts) p.geometry.dispose();
    disposeVegetation(vegetation);
  });

  it("swaps the style layer without moving anything", async () => {
    const a = await buildStyleLayer(await loader.loadStyle("european"));
    const b = await buildStyleLayer(await loader.loadStyle("japanese"));
    expect(b.signs).toEqual(a.signs);
    expect(b.parts.map((p) => p.geometry.boundingBox!.min.toArray())).toEqual(a.parts.map((p) => p.geometry.boundingBox!.min.toArray()));
    expect(new Vector3().copy(a.parts[0]!.geometry.boundingBox!.max).toArray()).toEqual(b.parts[0]!.geometry.boundingBox!.max.toArray());
    for (const p of [...a.parts, ...b.parts]) p.geometry.dispose();
  });
});
