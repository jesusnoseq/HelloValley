import { describe, expect, it } from "vitest";
import { ANIMAL_IDS, isFurTintFor } from "../data/animals";
import { NPC_IDS, NPCS } from "../data/npcs";
import { getSwatch } from "../data/palette";
import {
  CHARACTER_ANIMATIONS,
  CHARACTER_BODY_SOCKETS,
  CHARACTER_BONES,
  CHARACTER_HEAD_SOCKETS,
  CHARACTER_MATERIAL_SLOTS,
  type CharacterManifest,
  characterAnimalFile,
  characterColors,
  characterManifestProblems,
  characterOutfitFile,
  parseCharacterManifest,
} from "./characters";

function manifest(): CharacterManifest {
  const part = (name: string, socket: string, tris: number) => ({ name, socket, default: true, tris });
  return parseCharacterManifest({
    version: 1,
    generator: "test/1",
    fps: 24,
    height: 1.18,
    sitHeight: 0.11,
    slots: Object.fromEntries(Object.entries(CHARACTER_MATERIAL_SLOTS).map(([k, tint]) => [k, { tint }])),
    body: {
      file: "body.glb",
      tris: 1700,
      bones: [...CHARACTER_BONES],
      slots: ["trousers", "shirt", "fur"],
      sockets: CHARACTER_BODY_SOCKETS.map((name) => ({ name, bone: "spine", pos: [0, 0.5, 0] })),
    },
    animations: CHARACTER_ANIMATIONS.map((name) => ({ name, duration: 1, loop: name !== "heart" })),
    animals: ANIMAL_IDS.map((id) => ({ id, file: characterAnimalFile(id), tris: 1000, parts: [part("head", "head", 900), part("tail", "tail", 100)], sockets: [...CHARACTER_HEAD_SOCKETS] })),
    outfits: NPC_IDS.map((id) => ({ id, file: characterOutfitFile(id), tris: 300, parts: [part("hat", "hat", 300)] })),
  });
}

describe("character manifest", () => {
  it("accepts a complete set", () => {
    expect(characterManifestProblems(manifest())).toEqual([]);
  });

  it("reports missing clips, animals, outfits and budget overruns", () => {
    const m = manifest();
    m.animations.pop();
    m.animals.shift();
    m.outfits = m.outfits.slice(1);
    m.body.tris = 9000;
    const problems = characterManifestProblems(m).join("\n");
    expect(problems).toMatch(/animations/);
    expect(problems).toMatch(/animals do not match/);
    expect(problems).toMatch(/outfits do not match/);
    expect(problems).toMatch(/body: 9000 tris/);
  });

  it("rejects parts whose triangles do not add up, or unknown sockets", () => {
    const raw = JSON.parse(JSON.stringify(manifest())) as { animals: { tris: number; parts: { socket: string }[] }[] };
    raw.animals[0]!.tris = 1;
    expect(() => parseCharacterManifest(raw)).toThrow();
    const raw2 = JSON.parse(JSON.stringify(manifest())) as { outfits: { parts: { socket: string }[] }[] };
    raw2.outfits[0]!.parts[0]!.socket = "elbow";
    expect(() => parseCharacterManifest(raw2)).toThrow();
  });

  it("has 14 clips including the emotes", () => {
    expect(CHARACTER_ANIMATIONS).toHaveLength(14);
    expect(new Set(CHARACTER_ANIMATIONS).size).toBe(14);
  });
});

describe("NPC looks", () => {
  it("gives every NPC a distinct animal with one of its fur tints and palette clothes", () => {
    const animals = NPCS.map((n) => n.look.animal);
    expect(new Set(animals).size).toBe(NPCS.length);
    for (const npc of NPCS) {
      expect(ANIMAL_IDS, npc.id).toContain(npc.look.animal);
      expect(isFurTintFor(npc.look.animal, npc.look.furTint), npc.id).toBe(true);
      expect(getSwatch(npc.look.shirt), npc.id).toBeDefined();
      expect(getSwatch(npc.look.trousers), npc.id).toBeDefined();
      expect(characterColors({ ...npc.look, outfit: npc.id }), npc.id).not.toBeNull();
    }
  });

  it("resolves look colours and rejects unknown ids", () => {
    expect(characterColors({ animal: "fox", furTint: "russet", shirt: "sky", trousers: "navy" })).toEqual({
      fur: "#c8693a",
      shirt: "#aed6ef",
      trousers: "#4a5878",
    });
    expect(characterColors({ animal: "fox", furTint: "snow", shirt: "sky", trousers: "navy" })).toBeNull();
    expect(characterColors({ animal: "fox", furTint: "russet", shirt: "neon", trousers: "navy" })).toBeNull();
  });
});
