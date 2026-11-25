import { z } from "zod";
import { ANIMAL_IDS, getAnimal } from "../data/animals";
import { NPC_IDS } from "../data/npcs";
import { getSwatch } from "../data/palette";

/**
 * The generated character set (build plan M07, GDD §3): one skinned chibi body with the shared
 * skeleton and 14 clips, one GLB per animal (head, tail and optional parts) and one per NPC
 * outfit, in `public/assets/characters/`. Mirrors tools/blender/hvkit/character.py (a Python
 * test keeps the names equal).
 */
export const CHARACTER_MANIFEST_VERSION = 1;
export const CHARACTER_MANIFEST_FILE = "character-manifest.json";
export const CHARACTERS_PATH = "assets/characters";

export const CHARACTER_ANIMATIONS = [
  "idle",
  "walk",
  "run",
  "sit",
  "talk",
  "wave",
  "fish_cast",
  "fish_reel",
  "eat",
  "cheer",
  "laugh",
  "heart",
  "think",
  "clap",
] as const;
export type CharacterAnimation = (typeof CHARACTER_ANIMATIONS)[number];

export const CHARACTER_BONES = [
  "root",
  "hips",
  "spine",
  "head",
  "upper_arm_l",
  "upper_arm_r",
  "forearm_l",
  "forearm_r",
  "hand_l",
  "hand_r",
  "thigh_l",
  "thigh_r",
  "shin_l",
  "shin_r",
  "foot_l",
  "foot_r",
  "tail",
] as const;

/** Body sockets: empties named `socket_<name>` parented to bones in body.glb. */
export const CHARACTER_BODY_SOCKETS = ["head", "neck", "chest", "hips", "tail", "hand_l", "hand_r", "foot_l", "foot_r"] as const;
/** Head sockets: empties inside each animal's head node. */
export const CHARACTER_HEAD_SOCKETS = ["hat", "face", "ear_l", "ear_r"] as const;
export type CharacterSocket = (typeof CHARACTER_BODY_SOCKETS)[number] | (typeof CHARACTER_HEAD_SOCKETS)[number];
export const CHARACTER_SOCKET_PREFIX = "socket_";

/** Material slots (material extras `hv_slot`); `true` = tinted through `material.color`. */
export const CHARACTER_MATERIAL_SLOTS = {
  fur: true,
  shirt: true,
  trousers: true,
  eyes: false,
  markings: false,
  outfit: false,
} as const;
export type CharacterSlot = keyof typeof CHARACTER_MATERIAL_SLOTS;
export const CHARACTER_BODY_SLOTS = ["fur", "shirt", "trousers"] as const satisfies readonly CharacterSlot[];
export const CHARACTER_HEAD_SLOTS = ["fur", "eyes"] as const satisfies readonly CharacterSlot[];

/** Triangle budgets: the body, everything in one animal GLB, everything in one outfit GLB. */
export const CHARACTER_TRI_BUDGETS = {
  body: { min: 500, max: 3000 },
  animal: { min: 200, max: 3000 },
  outfit: { min: 12, max: 1500 },
} as const;

const NameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const FileSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]*\.glb$/);
const SocketSchema = z.enum([...CHARACTER_BODY_SOCKETS, ...CHARACTER_HEAD_SOCKETS]);

export const CharacterPartSchema = z.object({
  name: NameSchema,
  socket: SocketSchema,
  /** Shown unless the look says otherwise (floppy ears, antlers, flippers are optional). */
  default: z.boolean(),
  tris: z.number().int().min(0),
});

const CharacterFileSchema = z
  .object({ id: NameSchema, file: FileSchema, tris: z.number().int().min(0), parts: z.array(CharacterPartSchema).min(1) })
  .refine((f) => f.parts.reduce((n, p) => n + p.tris, 0) === f.tris, { message: "tris must be the sum of the parts" })
  .refine((f) => new Set(f.parts.map((p) => p.name)).size === f.parts.length, { message: "part names must be unique" });

export const CharacterAnimalSchema = z
  .object({ id: NameSchema, file: FileSchema, tris: z.number().int().min(0), parts: z.array(CharacterPartSchema).min(1), sockets: z.array(z.enum(CHARACTER_HEAD_SOCKETS)) })
  .refine((f) => f.parts.reduce((n, p) => n + p.tris, 0) === f.tris, { message: "tris must be the sum of the parts" })
  .refine((f) => f.parts.some((p) => p.name === "head" && p.socket === "head"), { message: "an animal needs a head part" });

export const CharacterManifestSchema = z.object({
  version: z.literal(CHARACTER_MANIFEST_VERSION),
  generator: z.string(),
  fps: z.number().int().positive(),
  /** Top of the skull in metres (ears and hats go higher). */
  height: z.number().positive(),
  /** In the `sit` clip the pelvis rests this high above the pivot. */
  sitHeight: z.number().positive(),
  slots: z.record(z.string(), z.object({ tint: z.boolean() })),
  body: z.object({
    file: FileSchema,
    tris: z.number().int().min(0),
    bones: z.array(z.string()),
    slots: z.array(z.string()),
    sockets: z.array(z.object({ name: z.enum(CHARACTER_BODY_SOCKETS), bone: z.string(), pos: z.tuple([z.number(), z.number(), z.number()]) })),
  }),
  animations: z.array(z.object({ name: z.enum(CHARACTER_ANIMATIONS), duration: z.number().positive(), loop: z.boolean() })),
  animals: z.array(CharacterAnimalSchema),
  outfits: z.array(CharacterFileSchema),
});
export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;
export type CharacterPart = z.infer<typeof CharacterPartSchema>;

export function parseCharacterManifest(data: unknown): CharacterManifest {
  return CharacterManifestSchema.parse(data);
}

function outside(label: string, tris: number, budget: { min: number; max: number }): string[] {
  return tris < budget.min || tris > budget.max ? [`${label}: ${tris} tris outside ${budget.min}-${budget.max}`] : [];
}

/** Problems that keep a manifest from being the complete M07 set: every animal and NPC outfit,
 * all 14 clips, the shared skeleton, sockets and slots, and the budgets. Empty = complete. */
export function characterManifestProblems(m: CharacterManifest): string[] {
  const problems: string[] = [];
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(m.animations.map((a) => a.name), CHARACTER_ANIMATIONS)) problems.push("animations do not match CHARACTER_ANIMATIONS");
  if (!same([...m.body.bones].sort(), [...CHARACTER_BONES].sort())) problems.push("body bones do not match CHARACTER_BONES");
  if (!same(m.body.sockets.map((s) => s.name), CHARACTER_BODY_SOCKETS)) problems.push("body sockets do not match");
  if (!same([...m.body.slots].sort(), [...CHARACTER_BODY_SLOTS].sort())) problems.push("body slots do not match");
  for (const [slot, tint] of Object.entries(CHARACTER_MATERIAL_SLOTS)) {
    if (m.slots[slot]?.tint !== tint) problems.push(`slot ${slot}: tint must be ${tint}`);
  }
  if (!same(m.animals.map((a) => a.id).sort(), [...ANIMAL_IDS].sort())) problems.push("animals do not match ANIMAL_IDS");
  if (!same(m.outfits.map((o) => o.id).sort(), [...NPC_IDS].sort())) problems.push("outfits do not match NPC_IDS");
  for (const a of m.animals) {
    if (!same(a.sockets, CHARACTER_HEAD_SOCKETS)) problems.push(`animal ${a.id}: head sockets do not match`);
    problems.push(...outside(`animal ${a.id}`, a.tris, CHARACTER_TRI_BUDGETS.animal));
  }
  for (const o of m.outfits) problems.push(...outside(`outfit ${o.id}`, o.tris, CHARACTER_TRI_BUDGETS.outfit));
  problems.push(...outside("body", m.body.tris, CHARACTER_TRI_BUDGETS.body));
  return problems;
}

/** What a character wears: an animal with one of its natural fur tints, shirt and trouser
 * swatches, optional-part overrides and, for NPCs, an outfit (the NPC id). */
export interface CharacterLook {
  animal: string;
  furTint: string;
  shirt: string;
  trousers: string;
  parts?: Readonly<Record<string, boolean>>;
  outfit?: string;
}

/** The colours a look resolves to (sRGB hex), or null when an id is unknown. */
export function characterColors(look: CharacterLook): { fur: string; shirt: string; trousers: string } | null {
  const fur = getAnimal(look.animal)?.furTints.find((t) => t.id === look.furTint)?.hex;
  const shirt = getSwatch(look.shirt)?.hex;
  const trousers = getSwatch(look.trousers)?.hex;
  return fur && shirt && trousers ? { fur, shirt, trousers } : null;
}

export function characterAnimalFile(animal: string): string {
  return `animal.${animal}.glb`;
}

export function characterOutfitFile(npcId: string): string {
  return `outfit.${npcId}.glb`;
}
