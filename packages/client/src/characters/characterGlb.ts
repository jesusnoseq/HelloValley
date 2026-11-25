import { AnimationAction, AnimationClip, AnimationMixer, Color, LoopOnce, LoopRepeat, Material, Mesh, type MeshStandardMaterial, type Object3D } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
  CHARACTER_MANIFEST_FILE,
  CHARACTER_MATERIAL_SLOTS,
  type CharacterLook,
  type CharacterManifest,
  type CharacterSlot,
  characterAnimalFile,
  characterColors,
  characterOutfitFile,
  parseCharacterManifest,
} from "@hellovalley/shared";
import { createKitGltfLoader, parseKitGlb } from "../assets/kitGlb";

/**
 * Loading and assembling the generated characters (tools/blender, M07): body.glb carries the
 * skinned body, the shared skeleton, socket empties and the 14 clips; each animal GLB carries
 * a head, a tail and optional parts; each NPC outfit GLB carries rigid pieces. Parts attach to
 * sockets by name (node extras `hv_socket`) and keep their own local transform (the optimizer
 * may have moved geometry into it). Tintable material slots (`hv_slot` fur, shirt, trousers)
 * are cloned per character and tinted through `material.color`.
 * TODO(M15/M16): the avatar component and network-driven animation state.
 */

export interface CharacterAssets {
  manifest: CharacterManifest;
  body: GLTF;
  animals: Map<string, GLTF>;
  outfits: Map<string, GLTF>;
}

/** Nodes carrying `hv_socket` extras, by socket name (the first one found wins). */
export function findSockets(root: Object3D, { partsToo = false } = {}): Map<string, Object3D> {
  const out = new Map<string, Object3D>();
  root.traverse((node) => {
    const socket = node.userData.hv_socket;
    if (typeof socket !== "string" || out.has(socket)) return;
    // Parts also carry hv_socket (the socket they attach to); only empties *are* sockets.
    if (!partsToo && typeof node.userData.hv_part === "string") return;
    out.set(socket, node);
  });
  return out;
}

/** The part nodes of an animal or outfit GLB (extras `hv_part`), in file order. */
export function partNodes(root: Object3D): Object3D[] {
  const out: Object3D[] = [];
  root.traverse((node) => {
    if (typeof node.userData.hv_part === "string") out.push(node);
  });
  return out;
}

function meshMaterials(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** The material slots (`hv_slot` extras) used under a node. */
export function materialSlots(root: Object3D): Set<string> {
  const slots = new Set<string>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    for (const m of meshMaterials(node)) if (typeof m.userData.hv_slot === "string") slots.add(m.userData.hv_slot);
  });
  return slots;
}

function joinUrl(base: string, file: string): string {
  return `${base.replace(/\/+$/, "")}/${file}`;
}

type FetchLike = (url: string) => Promise<Pick<Response, "ok" | "status" | "json" | "arrayBuffer">>;

/** Fetches the manifest, the body and the requested animals and outfits (all by default). */
export async function loadCharacterAssets(
  baseUrl: string,
  { animals, outfits, fetchImpl = fetch as FetchLike }: { animals?: readonly string[]; outfits?: readonly string[]; fetchImpl?: FetchLike } = {},
): Promise<CharacterAssets> {
  const res = await fetchImpl(joinUrl(baseUrl, CHARACTER_MANIFEST_FILE));
  if (!res.ok) throw new Error(`character manifest: HTTP ${res.status}`);
  const manifest = parseCharacterManifest(await res.json());
  const loader = createKitGltfLoader();
  const glb = async (file: string) => {
    const r = await fetchImpl(joinUrl(baseUrl, file));
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return parseKitGlb(await r.arrayBuffer(), loader);
  };
  const animalIds = animals ?? manifest.animals.map((a) => a.id);
  const outfitIds = outfits ?? manifest.outfits.map((o) => o.id);
  const [body, animalGltfs, outfitGltfs] = await Promise.all([
    glb(manifest.body.file),
    Promise.all(animalIds.map((id) => glb(characterAnimalFile(id)))),
    Promise.all(outfitIds.map((id) => glb(characterOutfitFile(id)))),
  ]);
  return {
    manifest,
    body,
    animals: new Map(animalIds.map((id, i) => [id, animalGltfs[i]!])),
    outfits: new Map(outfitIds.map((id, i) => [id, outfitGltfs[i]!])),
  };
}

export interface Character {
  root: Object3D;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  /** Every attached part node by name (head, tail, ears_floppy, apron...); optional parts
   * are hidden unless the look shows them. */
  parts: Map<string, Object3D>;
  /** Per-character copies of the tintable materials, by slot. */
  tints: Map<CharacterSlot, MeshStandardMaterial[]>;
  play(clip: string, fade?: number): AnimationAction;
  setTint(slot: CharacterSlot, hex: string): void;
  setPartVisible(name: string, visible: boolean): void;
}

/** Builds one character from loaded assets: the body clone, the animal's parts (optional
 * ones only when `look.parts` asks), the outfit pieces, tinted clothes and fur. */
export function assembleCharacter(assets: CharacterAssets, look: CharacterLook): Character {
  const animal = assets.animals.get(look.animal);
  if (!animal) throw new Error(`animal ${look.animal} is not loaded`);
  const colors = characterColors(look);
  if (!colors) throw new Error(`invalid look ${JSON.stringify(look)}`);

  const root = cloneSkinned(assets.body.scene);
  root.name = `character_${look.animal}`;
  const sockets = findSockets(root);
  const parts = new Map<string, Object3D>();
  const attach = (piece: Object3D, socketName: string, headSockets?: Map<string, Object3D>) => {
    const socket = sockets.get(socketName) ?? headSockets?.get(socketName);
    if (!socket) throw new Error(`no socket ${socketName}`);
    socket.add(piece); // keeps the piece's local transform: it was authored relative to the socket
    parts.set(piece.userData.hv_part as string, piece);
  };

  const animalRoot = animal.scene.clone(true);
  for (const node of partNodes(animalRoot)) {
    // Every part is attached; optional ones start hidden unless the look asks for them.
    const name = node.userData.hv_part as string;
    attach(node, node.userData.hv_socket as string);
    node.visible = look.parts?.[name] ?? node.userData.hv_default !== false;
  }
  const headSockets = parts.get("head") ? findSockets(parts.get("head")!) : new Map<string, Object3D>();
  if (look.outfit) {
    const outfit = assets.outfits.get(look.outfit);
    if (!outfit) throw new Error(`outfit ${look.outfit} is not loaded`);
    for (const node of partNodes(outfit.scene.clone(true))) attach(node, node.userData.hv_socket as string, headSockets);
  }

  // Tintable slots get one material copy per character, shared by its meshes.
  const tints = new Map<CharacterSlot, MeshStandardMaterial[]>();
  const copies = new Map<Material, Material>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const mats = meshMaterials(node).map((m) => {
      const slot = m.userData.hv_slot as CharacterSlot | undefined;
      if (!slot || !CHARACTER_MATERIAL_SLOTS[slot]) return m;
      let copy = copies.get(m);
      if (!copy) {
        copy = m.clone();
        copies.set(m, copy);
        tints.set(slot, [...(tints.get(slot) ?? []), copy as MeshStandardMaterial]);
      }
      return copy;
    });
    node.material = Array.isArray(node.material) ? mats : mats[0]!;
  });

  const mixer = new AnimationMixer(root);
  const actions = new Map<string, AnimationAction>();
  for (const info of assets.manifest.animations) {
    const clip = AnimationClip.findByName(assets.body.animations, info.name);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(info.loop ? LoopRepeat : LoopOnce, info.loop ? Infinity : 1);
    action.clampWhenFinished = !info.loop;
    actions.set(info.name, action);
  }
  let current: AnimationAction | null = null;

  const character: Character = {
    root,
    mixer,
    actions,
    parts,
    tints,
    play(name, fade = 0.2) {
      const next = actions.get(name);
      if (!next) throw new Error(`unknown clip ${name}`);
      if (next === current && next.isRunning()) return next;
      next.reset().setEffectiveWeight(1).play();
      if (current && current !== next) {
        if (fade > 0 && current.isRunning()) current.crossFadeTo(next, fade, false);
        else current.stop();
      }
      current = next;
      return next;
    },
    setTint(slot, hex) {
      for (const m of tints.get(slot) ?? []) m.color = new Color(hex);
    },
    setPartVisible(name, visible) {
      const node = parts.get(name);
      if (node) node.visible = visible;
    },
  };
  character.setTint("fur", colors.fur);
  character.setTint("shirt", colors.shirt);
  character.setTint("trousers", colors.trousers);
  return character;
}
