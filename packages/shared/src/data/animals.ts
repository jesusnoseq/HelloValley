import { z } from "zod";

/** A natural fur colour. Each animal offers 3–4, so there are no neon foxes (GDD §3.2). */
export interface FurTint {
  id: string;
  hex: string;
}

export interface AnimalDef {
  id: string;
  englishName: string;
  /** Personality hint for flavour text. */
  personality: string;
  /** Mesh features the character generator adds to the shared rig (M07). */
  features: string;
  furTints: readonly FurTint[];
}

export const ANIMALS = [
  {
    id: "fox",
    englishName: "Fox",
    personality: "Clever, curious",
    features: "Bushy tail",
    furTints: [
      { id: "russet", hex: "#c8693a" },
      { id: "amber", hex: "#d98b4a" },
      { id: "silver", hex: "#a9a7a3" },
      { id: "arctic", hex: "#ece8e0" },
    ],
  },
  {
    id: "rabbit",
    englishName: "Rabbit",
    personality: "Energetic, gentle",
    features: "Long ears (floppy or upright variant)",
    furTints: [
      { id: "snow", hex: "#f3f0ea" },
      { id: "cocoa", hex: "#8a6a55" },
      { id: "sandy", hex: "#cfb08a" },
      { id: "grey", hex: "#9c9a98" },
    ],
  },
  {
    id: "cat",
    englishName: "Cat",
    personality: "Independent, playful",
    features: "Tail; tabby / plain pattern",
    furTints: [
      { id: "ginger", hex: "#d4874a" },
      { id: "black", hex: "#3a3634" },
      { id: "grey", hex: "#8e8c8a" },
      { id: "cream", hex: "#eadcc2" },
    ],
  },
  {
    id: "dog",
    englishName: "Dog (Shiba-like)",
    personality: "Loyal, cheerful",
    features: "Curled tail",
    furTints: [
      { id: "red", hex: "#c97a45" },
      { id: "sesame", hex: "#a5774f" },
      { id: "black_tan", hex: "#4a3a30" },
      { id: "cream", hex: "#eee0c6" },
    ],
  },
  {
    id: "bear",
    englishName: "Bear",
    personality: "Warm, calm",
    features: "Round ears",
    furTints: [
      { id: "brown", hex: "#7a5236" },
      { id: "honey", hex: "#b4824e" },
      { id: "black", hex: "#3b3532" },
      { id: "polar", hex: "#efeae0" },
    ],
  },
  {
    id: "red_panda",
    englishName: "Red panda",
    personality: "Shy, sweet",
    features: "Striped tail, face markings",
    furTints: [
      { id: "rust", hex: "#b8562e" },
      { id: "auburn", hex: "#9c4a2c" },
      { id: "copper", hex: "#c9733f" },
    ],
  },
  {
    id: "raccoon",
    englishName: "Raccoon",
    personality: "Mischievous",
    features: "Mask marking, ringed tail",
    furTints: [
      { id: "grey", hex: "#8a8682" },
      { id: "brownish", hex: "#8c7865" },
      { id: "pale", hex: "#b8b2aa" },
    ],
  },
  {
    id: "hedgehog",
    englishName: "Hedgehog",
    personality: "Cautious, kind",
    features: "Soft rounded spikes",
    furTints: [
      { id: "brown", hex: "#8b6b4e" },
      { id: "cinnamon", hex: "#b07a4f" },
      { id: "pale", hex: "#d8c7ac" },
    ],
  },
  {
    id: "otter",
    englishName: "Otter",
    personality: "Playful, social",
    features: "Flat tail",
    furTints: [
      { id: "chocolate", hex: "#6b4a33" },
      { id: "chestnut", hex: "#8a5e3d" },
      { id: "dusky", hex: "#7c6a5c" },
    ],
  },
  {
    id: "capybara",
    englishName: "Capybara",
    personality: "Unbothered, zen",
    features: "Optional tiny orange on head",
    furTints: [
      { id: "tawny", hex: "#a77c52" },
      { id: "chestnut", hex: "#8e6342" },
      { id: "sand", hex: "#c09b6e" },
    ],
  },
  {
    id: "koala",
    englishName: "Koala",
    personality: "Sleepy, cuddly",
    features: "Fluffy ears",
    furTints: [
      { id: "grey", hex: "#a4a2a0" },
      { id: "ash", hex: "#8a8886" },
      { id: "brownish", hex: "#9a8878" },
    ],
  },
  {
    id: "penguin",
    englishName: "Penguin",
    personality: "Formal, funny",
    features: "Flipper hands variant",
    furTints: [
      { id: "black", hex: "#2f3336" },
      { id: "slate", hex: "#4b5660" },
      { id: "chick_grey", hex: "#9da3a8" },
    ],
  },
  {
    id: "owl",
    englishName: "Owl",
    personality: "Wise, bookish",
    features: "Feather tufts",
    furTints: [
      { id: "tawny", hex: "#9a6c44" },
      { id: "barn", hex: "#d8b788" },
      { id: "snowy", hex: "#f0ede6" },
      { id: "grey", hex: "#8f8a84" },
    ],
  },
  {
    id: "frog",
    englishName: "Frog",
    personality: "Cheerful, quirky",
    features: "Wide smile",
    furTints: [
      { id: "leaf", hex: "#7fa75a" },
      { id: "moss", hex: "#6b8b4a" },
      { id: "lime", hex: "#a6c46a" },
      { id: "olive", hex: "#8a8f4e" },
    ],
  },
  {
    id: "sheep",
    englishName: "Sheep",
    personality: "Soft, dreamy",
    features: "Wool cap mesh",
    furTints: [
      { id: "white", hex: "#f2efe8" },
      { id: "cream", hex: "#e6dac4" },
      { id: "grey", hex: "#a9a6a2" },
      { id: "black", hex: "#3d3936" },
    ],
  },
  {
    id: "deer",
    englishName: "Deer",
    personality: "Graceful, gentle",
    features: "Small antlers optional",
    furTints: [
      { id: "fawn", hex: "#b98556" },
      { id: "chestnut", hex: "#93603b" },
      { id: "sika", hex: "#a8764a" },
    ],
  },
] as const satisfies readonly AnimalDef[];

export type AnimalId = (typeof ANIMALS)[number]["id"];
export const ANIMAL_IDS = ANIMALS.map((a) => a.id) as readonly AnimalId[];
export const AnimalIdSchema = z.enum(ANIMAL_IDS as [AnimalId, ...AnimalId[]]);

export function getAnimal(id: string): AnimalDef | undefined {
  return ANIMALS.find((a) => a.id === id);
}

export function isAnimalId(value: unknown): value is AnimalId {
  return typeof value === "string" && (ANIMAL_IDS as readonly string[]).includes(value);
}

/** True when `tintId` is one of this animal's natural fur tints. */
export function isFurTintFor(animalId: string, tintId: string): boolean {
  return getAnimal(animalId)?.furTints.some((t) => t.id === tintId) ?? false;
}
