/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box3, Mesh, type Object3D, Quaternion, SkinnedMesh, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ANIMAL_IDS,
  CHARACTER_ANIMATIONS,
  CHARACTER_BODY_SLOTS,
  CHARACTER_BODY_SOCKETS,
  CHARACTER_BONES,
  CHARACTER_HEAD_SLOTS,
  CHARACTER_HEAD_SOCKETS,
  CHARACTER_MANIFEST_FILE,
  NPCS,
  characterManifestProblems,
  getAnimal,
  parseCharacterManifest,
} from "@hellovalley/shared";
import { countTris } from "../assets/kitGlb";
import { assembleCharacter, type CharacterAssets, findSockets, loadCharacterAssets, materialSlots, partNodes } from "./characterGlb";

// The committed character set (M07), generated with `npm run assets:build -- --characters`.
// This is the automated stand-in for the dev gallery (/dev/characters): it loads every GLB
// with three.js, checks the 14 clips, sockets and material slots, then assembles every animal
// and NPC, tints them and plays every clip.
const DIR = new URL("../../public/assets/characters/", import.meta.url);
const present = existsSync(fileURLToPath(new URL(CHARACTER_MANIFEST_FILE, DIR)));

async function fakeFetch(url: string) {
  const path = fileURLToPath(new URL(url.replace(/^.*\//, ""), DIR));
  const bytes = readFileSync(path);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")) as unknown,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

function worldPos(node: Object3D): Vector3 {
  node.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixPosition(node.matrixWorld);
}

function boneQuats(root: Object3D): Map<string, Quaternion> {
  const out = new Map<string, Quaternion>();
  root.traverse((n) => {
    if ((CHARACTER_BONES as readonly string[]).includes(n.name)) out.set(n.name, n.quaternion.clone());
  });
  return out;
}

describe.skipIf(!present)("characters (public/assets/characters)", () => {
  let assets: CharacterAssets;
  beforeAll(async () => {
    assets = await loadCharacterAssets("/assets/characters", { fetchImpl: fakeFetch });
  });

  it("has a complete manifest within budgets", () => {
    const manifest = parseCharacterManifest(JSON.parse(readFileSync(fileURLToPath(new URL(CHARACTER_MANIFEST_FILE, DIR)), "utf8")));
    expect(characterManifestProblems(manifest)).toEqual([]);
    expect(assets.manifest.animals.map((a) => a.id).sort()).toEqual([...ANIMAL_IDS].sort());
  });

  it("ships all 14 clips in body.glb with the manifest durations", () => {
    const names = assets.body.animations.map((a) => a.name);
    expect(names.sort()).toEqual([...CHARACTER_ANIMATIONS].sort());
    for (const info of assets.manifest.animations) {
      const clip = assets.body.animations.find((a) => a.name === info.name)!;
      expect(clip.duration, info.name).toBeCloseTo(info.duration, 2);
      expect(clip.tracks.length, info.name).toBeGreaterThan(0);
    }
  });

  it("skins the body to the shared skeleton with fur, shirt and trousers slots", () => {
    const skinned: SkinnedMesh[] = [];
    assets.body.scene.traverse((n) => {
      if (n instanceof SkinnedMesh) skinned.push(n);
    });
    expect(skinned.length).toBeGreaterThan(0);
    const bones = skinned[0]!.skeleton.bones.map((b) => b.name).sort();
    expect(bones).toEqual([...CHARACTER_BONES].sort());
    expect([...materialSlots(assets.body.scene)].sort()).toEqual([...CHARACTER_BODY_SLOTS].sort());
    for (const mesh of skinned) {
      expect(mesh.geometry.getAttribute("color")).toBeDefined();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) expect(m.userData.hv_tint).toBe(true);
    }
    expect(countTris(assets.body.scene)).toBe(assets.manifest.body.tris);
  });

  it("puts every body socket on its bone at the manifest position", () => {
    const sockets = findSockets(assets.body.scene);
    expect([...sockets.keys()].sort()).toEqual([...CHARACTER_BODY_SOCKETS].sort());
    for (const s of assets.manifest.body.sockets) {
      const node = sockets.get(s.name)!;
      expect(node.parent?.name, s.name).toBe(s.bone);
      const p = worldPos(node);
      for (let i = 0; i < 3; i++) expect(p.getComponent(i), `${s.name}[${i}]`).toBeCloseTo(s.pos[i]!, 2);
    }
  });

  it.each(ANIMAL_IDS.map((id) => [id]))("animal %s has a head with fur and eyes, head sockets and its parts", (id) => {
    const gltf = assets.animals.get(id)!;
    const entry = assets.manifest.animals.find((a) => a.id === id)!;
    const parts = partNodes(gltf.scene);
    expect(parts.map((p) => p.userData.hv_part).sort()).toEqual(entry.parts.map((p) => p.name).sort());
    for (const p of entry.parts) {
      const node = parts.find((n) => n.userData.hv_part === p.name)!;
      expect(node.userData.hv_socket, p.name).toBe(p.socket);
      expect(countTris(node), p.name).toBe(p.tris);
    }
    const head = parts.find((n) => n.userData.hv_part === "head")!;
    const slots = materialSlots(head);
    for (const slot of CHARACTER_HEAD_SLOTS) expect(slots.has(slot), `${id} ${slot}`).toBe(true);
    expect([...findSockets(head).keys()].sort()).toEqual([...CHARACTER_HEAD_SOCKETS].sort());
  });

  it("gives every NPC an outfit whose pieces attach to known sockets", () => {
    for (const npc of NPCS) {
      const gltf = assets.outfits.get(npc.id)!;
      const pieces = partNodes(gltf.scene);
      expect(pieces.length, npc.id).toBeGreaterThan(0);
      for (const piece of pieces) {
        expect([...CHARACTER_BODY_SOCKETS, ...CHARACTER_HEAD_SOCKETS], npc.id).toContain(piece.userData.hv_socket);
        expect([...materialSlots(piece)], npc.id).toEqual(["outfit"]);
      }
    }
  });

  it.each(ANIMAL_IDS.map((id) => [id]))("assembles %s, tints it and plays every clip", (id) => {
    const furTint = getAnimal(id)!.furTints[0]!.id;
    const c = assembleCharacter(assets, { animal: id, furTint, shirt: "coral", trousers: "navy" });
    expect(c.parts.has("head")).toBe(true);
    c.setTint("shirt", "#ff0000");
    expect(c.tints.get("shirt")!.every((m) => m.color.r > 0.9 && m.color.g < 0.05)).toBe(true);
    // Tinting one character does not touch the shared GLB materials.
    assets.body.scene.traverse((n) => {
      if (n instanceof Mesh) for (const m of [n.material].flat()) expect(m.color.g, "shared material").toBeGreaterThan(0.9);
    });

    // Rest pose: feet on the ground, the head about 1.2 m up.
    c.root.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(c.root, true);
    expect(box.min.y).toBeGreaterThan(-0.05);
    expect(box.min.y).toBeLessThan(0.05);
    expect(box.max.y).toBeGreaterThan(1.05);
    expect(box.max.y).toBeLessThan(1.8);

    const rest = boneQuats(c.root);
    expect(c.actions.size).toBe(CHARACTER_ANIMATIONS.length);
    for (const name of CHARACTER_ANIMATIONS) {
      c.mixer.stopAllAction();
      const action = c.play(name, 0);
      c.mixer.setTime(action.getClip().duration * 0.3);
      const posed = boneQuats(c.root);
      const moved = [...posed].filter(([bone, q]) => q.angleTo(rest.get(bone)!) > 0.05);
      expect(moved.length, `${id} ${name}`).toBeGreaterThan(0);
    }
  });

  it("assembles every NPC in its look and outfit", () => {
    for (const npc of NPCS) {
      const c = assembleCharacter(assets, { ...npc.look, outfit: npc.id });
      const pieces = partNodes(assets.outfits.get(npc.id)!.scene).map((p) => p.userData.hv_part as string);
      for (const piece of pieces) expect(c.parts.has(piece), `${npc.id} ${piece}`).toBe(true);
      c.play("talk");
      c.mixer.update(0.4);
    }
  });

  it("shows optional parts only when the look asks for them", () => {
    const plain = assembleCharacter(assets, { animal: "rabbit", furTint: "snow", shirt: "mint", trousers: "navy" });
    expect(plain.parts.get("ears_upright")?.visible).toBe(true);
    expect(plain.parts.get("ears_floppy")?.visible).toBe(false);
    const floppy = assembleCharacter(assets, { animal: "rabbit", furTint: "snow", shirt: "mint", trousers: "navy", parts: { ears_upright: false, ears_floppy: true } });
    expect(floppy.parts.get("ears_upright")?.visible).toBe(false);
    expect(floppy.parts.get("ears_floppy")?.visible).toBe(true);
    floppy.setPartVisible("ears_upright", true);
    expect(floppy.parts.get("ears_upright")?.visible).toBe(true);
  });
});
