/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Mesh, type Object3D, Texture } from "three";
import { describe, expect, it } from "vitest";
import { ANIMALS, CHARACTER_MANIFEST_FILE, INTERIOR_IDS, INTERIOR_KIT_ID, interiorEntrance, interiorLayout } from "@hellovalley/shared";
import { assembleAvatar } from "../characters/avatarLook";
import { loadCharacterAssets } from "../characters/characterGlb";
import { DRAW_CALL_BUDGET, estimateDrawCalls } from "./drawCalls";
import { buildInteriorMeshes, disposeInteriorMeshes, interiorDrawItems, interiorPlacements } from "./interiorMeshes";
import { createKitLoader } from "./kitLoader";
import { CHARACTER_MESHES_MAX, playerDrawItems } from "./playerDraw";

const PUBLIC = new URL("../../public/", import.meta.url);
const kitPresent = existsSync(fileURLToPath(new URL(`assets/kits/${INTERIOR_KIT_ID}/kit-manifest.json`, PUBLIC)));
const charactersPresent = existsSync(fileURLToPath(new URL(`assets/characters/${CHARACTER_MANIFEST_FILE}`, PUBLIC)));

function fetchFromPublic(url: string) {
  const file = fileURLToPath(new URL(url.replace(/^\//, ""), PUBLIC));
  const ok = existsSync(file);
  const bytes = ok ? readFileSync(file) : Buffer.alloc(0);
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    json: () => Promise.resolve(JSON.parse(bytes.toString("utf8")) as unknown),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
  });
}

const loader = createKitLoader({ baseUrl: "/", fetchImpl: fetchFromPublic, loadTexture: () => Promise.resolve(new Texture()) });

/** Meshes that draw (visible all the way up). */
function visibleMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  const walk = (node: Object3D) => {
    if (!node.visible) return;
    if (node instanceof Mesh) out.push(node);
    for (const c of node.children) walk(c);
  };
  walk(root);
  return out;
}

describe.skipIf(!charactersPresent)("player avatars", () => {
  it.each(ANIMALS.map((a) => [a.id, a.furTints.at(-1)!.id] as const))("%s assembles within the character mesh and triangle budget", async (animal, fur) => {
    const assets = await loadCharacterAssets("/assets/characters", { animals: [animal], outfits: [], fetchImpl: fetchFromPublic });
    const character = assembleAvatar(assets, { animal, colors: { fur, shirt: { h: 20, s: 0.5, l: 0.7 }, trousers: { swatch: "navy" } } });
    const meshes = visibleMeshes(character.root);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(CHARACTER_MESHES_MAX);
    const tris = meshes.reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3, 0);
    expect(tris).toBeLessThan(6000);
    for (const clip of ["idle", "walk", "run"]) expect(character.actions.has(clip)).toBe(true);
  });
});

describe.skipIf(!kitPresent)("interior scenes", () => {
  it.each(INTERIOR_IDS)("%s: builds from the interior kit within the draw-call and triangle budgets", async (id) => {
    const kit = await loader.load(INTERIOR_KIT_ID);
    const layout = interiorLayout(id);
    for (const p of interiorPlacements(layout)) expect(kit.has(p.module), p.module).toBe(true);
    const meshes = await buildInteriorMeshes(layout, kit);
    // Floor + furniture, and each of the four wall sides on its own for the cut-away.
    const groups = new Set(meshes.parts.map((p) => p.group));
    for (const g of ["room", "north", "east", "south", "west"] as const) expect(groups.has(g), g).toBe(true);
    // Mirrors and paintings hang in their wall's decor group.
    const hanging = layout.furniture.filter((p) => p.module === "mirror" || p.module === "painting").length;
    expect([...groups].some((g) => g.startsWith("decor:"))).toBe(hanging > 0);
    expect(meshes.triangles).toBeLessThan(60_000);
    const calls = estimateDrawCalls([...interiorDrawItems(meshes), ...playerDrawItems()]);
    expect(calls.total, JSON.stringify(calls)).toBeLessThan(DRAW_CALL_BUDGET);
    // The doorway sits where the shared entrance says.
    const door = meshes.parts.find((p) => p.group === layout.door.side && p.kind === "atlas")!;
    door.geometry.computeBoundingBox();
    const { position } = interiorEntrance(layout);
    const box = door.geometry.boundingBox!;
    expect(position[0]).toBeGreaterThanOrEqual(box.min.x - 1e-6);
    expect(position[0]).toBeLessThanOrEqual(box.max.x + 1e-6);
    // The wall stands outside the floor; only its skirting and trims (under 5 cm) reach in.
    expect(box.min.z).toBeGreaterThanOrEqual(layout.d - 0.05);
    disposeInteriorMeshes(meshes);
  });
});
