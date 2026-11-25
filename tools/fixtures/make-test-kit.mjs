#!/usr/bin/env node
// Writes a tiny committed test kit without Blender: test.cube.glb + kit-manifest.json in
// packages/client/test/fixtures/kits-synthetic/european/. It mirrors what tools/blender/build.py
// produces for the `test.cube` module (same GLB layout, extras, pivot, sockets and manifest
// entry, but a plain unbevelled cube), and runs it through the same optimize step (meshopt),
// so the client loader test covers the real decode path.
//
//   npm run assets:fixtures
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Document } from "@gltf-transform/core";
import { createIO, optimizeDocument } from "../optimize-assets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURE_DIR = join(ROOT, "packages", "client", "test", "fixtures", "kits-synthetic", "european");

// European wall swatches (tools/blender/hvkit/styles.py), converted to linear like the generator.
const WALLS = ["#f3e9d2", "#f6e3a1", "#c9d8b6"];

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToLinear(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
}

/** A unit cube in glTF space with the module pivot: x [0,1], y [0,1], z [-1,0]. */
function cubeGeometry() {
  // [normal, four corners counter-clockwise seen from outside]
  const faces = [
    [[0, 0, 1], [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]], // front (z = 0)
    [[0, 0, -1], [[1, 0, -1], [0, 0, -1], [0, 1, -1], [1, 1, -1]]], // back
    [[1, 0, 0], [[1, 0, 0], [1, 0, -1], [1, 1, -1], [1, 1, 0]]], // right
    [[-1, 0, 0], [[0, 0, -1], [0, 0, 0], [0, 1, 0], [0, 1, -1]]], // left
    [[0, 1, 0], [[0, 1, 0], [1, 1, 0], [1, 1, -1], [0, 1, -1]]], // top
    [[0, -1, 0], [[0, 0, -1], [1, 0, -1], [1, 0, 0], [0, 0, 0]]], // bottom
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  faces.forEach(([normal, corners], f) => {
    corners.forEach((p) => {
      positions.push(...p);
      normals.push(...normal);
    });
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    const b = f * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { positions, normals, uvs, indices };
}

export function buildTestCubeDocument() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const material = doc
    .createMaterial("hv_european_atlas")
    .setRoughnessFactor(0.9)
    .setMetallicFactor(0)
    .setExtras({ hv_atlas: true });
  const scene = doc.createScene("Scene");
  const geo = cubeGeometry();
  WALLS.forEach((hex, variant) => {
    const [r, g, b] = hexToLinear(hex);
    const colors = new Float32Array((geo.positions.length / 3) * 4);
    for (let i = 0; i < colors.length; i += 4) colors.set([r, g, b, 1], i);
    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(geo.indices)).setBuffer(buffer))
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.positions)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(geo.normals)).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(geo.uvs)).setBuffer(buffer))
      .setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(colors).setBuffer(buffer));
    const mesh = doc.createMesh(`test.cube.v${variant}.mesh`).addPrimitive(prim);
    const child = doc.createNode(`test.cube.v${variant}.mesh`).setMesh(mesh);
    const root = doc
      .createNode(`v${variant}`)
      .setExtras({ hv_module: "test.cube", hv_variant: variant, hv_style: "european" })
      .addChild(child);
    scene.addChild(root);
  });
  doc.getRoot().setDefaultScene(scene);
  return doc;
}

/** The manifest the Blender build writes for this module (tools/blender/hvkit/manifest.py). */
export function testCubeManifest() {
  return {
    version: 1,
    generator: "hellovalley-fixture/1",
    style: "european",
    grid: { cell: 1.0, storey: 3.0 },
    atlas: null,
    modules: [
      {
        id: "test.cube",
        file: "test.cube.glb",
        footprint: { w: 1, d: 1, h: 1.0 },
        variants: 3,
        bounds: { min: [0.0, 0.0, -1.0], max: [1.0, 1.0, 0.0] },
        sockets: [
          { name: "top", kind: "stack", pos: [0.5, 1.0, -0.5], normal: [0.0, 1.0, 0.0] },
          { name: "front", kind: "attach", pos: [0.5, 0.5, 0.0], normal: [0.0, 0.0, 1.0] },
        ],
        tris: [12, 12, 12],
        tags: ["test"],
      },
    ],
  };
}

async function main() {
  const io = await createIO();
  const doc = buildTestCubeDocument();
  await optimizeDocument(doc, { textures: "none" });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const glb = await io.writeBinary(doc);
  writeFileSync(join(FIXTURE_DIR, "test.cube.glb"), glb);
  writeFileSync(join(FIXTURE_DIR, "kit-manifest.json"), `${JSON.stringify(testCubeManifest(), null, 2)}\n`);
  console.log(`wrote ${FIXTURE_DIR} (test.cube.glb ${glb.byteLength} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
