import { BufferAttribute, BufferGeometry, ShaderLib, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { GRASS_TUFT_VARIANTS } from "@hellovalley/shared";
import { KIT_GEOMETRY_ATTRIBUTES, type KitGeometryPart } from "./kitLoader";
import { patchRiverShader, RIVER_SHADER_HOOKS, waterNormalTexels } from "./riverMaterial";
import { BELOW_PIVOT_SWAY, canopyGeometry, grassTuftGeometry, SWAY_FLEX, SWAY_VERTEX, swayFlexFor, swayValues, tuftMatrix } from "./vegetation";

const grass = { uv: [[0.1, 0.2], [0.3, 0.2], [0.1, 0.4], [0.3, 0.4]] as [number, number][], color: [0.3, 0.55, 0.2] as [number, number, number] };

function part(kind: KitGeometryPart["kind"], ys: number[], pivotY: number): KitGeometryPart {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(ys.flatMap((y, i) => [i, y, 0])), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(ys.length * 3), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(ys.length * 2), 2));
  g.setAttribute("color", new BufferAttribute(new Float32Array(ys.length * 3), 3));
  g.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return { kind, part: kind === "canopy" ? "canopy" : "trunk", pivot: [0, pivotY, 0], geometry: g };
}

describe("wind sway", () => {
  it("weights each vertex by its height above the pivot", () => {
    expect(Array.from(swayValues([0, 2, 0, 0, 3, 0, 0, 1, 0], 2, 1.5))).toEqual([0, 1.5, -1.5 * BELOW_PIVOT_SWAY]);
    expect(swayFlexFor("tree.conifer")).toBe(SWAY_FLEX.tree);
    expect(swayFlexFor("bush")).toBe(SWAY_FLEX.bush);
    expect(swayFlexFor("flowers")).toBe(SWAY_FLEX.flowers);
    expect(SWAY_FLEX.grass).toBeGreaterThan(SWAY_FLEX.tree);
  });

  it("merges only the canopy meshes of a plant", () => {
    const g = canopyGeometry([part("atlas", [0, 1, 2], 0), part("canopy", [2, 3, 4], 2), part("canopy", [2, 2.5, 3], 2)], 1)!;
    expect(g.index!.count).toBe(6);
    const sway = g.getAttribute("sway");
    expect(sway.count).toBe(6);
    expect(sway.getX(0)).toBe(0);
    expect(sway.getX(2)).toBe(2);
    expect(canopyGeometry([part("atlas", [0, 1, 2], 0)], 1)).toBeNull();
  });

  it("injects the sway into both the standard and the depth vertex shader", () => {
    for (const shader of [ShaderLib.standard.vertexShader, ShaderLib.depth.vertexShader]) {
      expect(shader).toContain("#include <begin_vertex>");
      expect(shader).toContain("#include <common>");
      // begin_vertex runs after batching_vertex, so the batching matrix is in scope.
      expect(shader.indexOf("#include <batching_vertex>")).toBeLessThan(shader.indexOf("#include <begin_vertex>"));
    }
    expect(SWAY_VERTEX).toContain("transformed += hvLocal * sway");
  });
});

describe("grass clusters", () => {
  it("are a few double-sided blades in the kit attribute layout plus sway", () => {
    for (let v = 0; v < GRASS_TUFT_VARIANTS; v++) {
      const g = grassTuftGeometry(v, grass);
      const triangles = g.index!.count / 3;
      expect(triangles).toBeGreaterThanOrEqual(8);
      expect(triangles).toBeLessThanOrEqual(14);
      expect(triangles % 2).toBe(0);
      for (const [name, size] of Object.entries(KIT_GEOMETRY_ATTRIBUTES)) expect(g.getAttribute(name).itemSize).toBe(size);
      expect(g.getAttribute("sway").count).toBe(g.getAttribute("position").count);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeCloseTo(0);
      expect(g.boundingBox!.max.y).toBeLessThan(0.35);
      // Roots stay put, tips sway.
      const sway = g.getAttribute("sway");
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) expect(sway.getX(i)).toBeCloseTo(pos.getY(i) * SWAY_FLEX.grass);
      // Painted with the grass tile.
      expect(g.getAttribute("uv").getX(0)).toBeCloseTo(0.2);
    }
    // The blooming looks carry a flower head.
    expect(grassTuftGeometry(2, grass).index!.count).toBeGreaterThan(grassTuftGeometry(0, grass).index!.count);
  });

  it("places a cluster with its yaw and scale", () => {
    const m = tuftMatrix({ x: 3, z: 4, yaw: Math.PI / 2, scale: 1.1, variant: 0 });
    const p = new Vector3(1, 0, 0).applyMatrix4(m);
    expect(p.x).toBeCloseTo(3);
    expect(p.z).toBeCloseTo(4 - 1.1);
  });
});

describe("river shader", () => {
  it("builds a tileable normal map facing up", () => {
    const size = 32;
    const t = waterNormalTexels(size);
    expect(t.length).toBe(size * size * 4);
    const at = (x: number, y: number, c: number) => t[(y * size + x) * 4 + c]!;
    let maxStep = 0;
    for (let y = 0; y < size; y++) for (let x = 1; x < size; x++) maxStep = Math.max(maxStep, Math.abs(at(x, y, 0) - at(x - 1, y, 0)));
    for (let y = 0; y < size; y++) {
      // The seam between the last and first column is no bigger than any step inside.
      expect(Math.abs(at(0, y, 0) - at(size - 1, y, 0))).toBeLessThanOrEqual(maxStep);
      for (let x = 0; x < size; x++) expect(at(x, y, 2)).toBeGreaterThan(160);
    }
  });

  it("patches every hook of the standard shader", () => {
    for (const hook of RIVER_SHADER_HOOKS.vertex) expect(ShaderLib.standard.vertexShader).toContain(hook);
    for (const hook of RIVER_SHADER_HOOKS.fragment) expect(ShaderLib.standard.fragmentShader).toContain(hook);
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    patchRiverShader(shader);
    expect(shader.vertexShader).toContain("vHvWorld = (modelMatrix");
    for (const marker of ["uniform sampler2D uHvShore", "hvFoam", "normal = normalize((viewMatrix", "outgoingLight = mix(outgoingLight, uHvSky"]) {
      expect(shader.fragmentShader).toContain(marker);
    }
    // The depth tint runs before the normal perturbation, which runs before the reflection.
    const f = shader.fragmentShader;
    expect(f.indexOf("float hvFoam")).toBeLessThan(f.indexOf("vec3 hvN"));
    expect(f.indexOf("vec3 hvN")).toBeLessThan(f.indexOf("float hvFres"));
    expect(f.indexOf("float hvFres")).toBeLessThan(f.indexOf("#include <opaque_fragment>"));
  });
});
