import { z } from "zod";
import type { AnimalId } from "./animals";
import type { ItemId } from "./items";
import type { SwatchId } from "./palette";
import { clockToMinutes, type BuildingId, type PlaceId } from "./world";

/** Inline TTS tags for brief vocal events (docs/hellovalley-village-npcs.md § Voice). */
export type TtsTag = "<laugh>" | "<sigh>" | "<cough>" | "<breath>" | "<short pause>";

export interface NpcVoice {
  /** Gemini TTS prebuilt voice name (`speech_metadata.speaker`). */
  prebuiltVoice: string;
  /** The voice's characteristic as listed in the Gemini docs. */
  character: string;
  /** Sustained delivery (`speech_metadata.style`). It stays the same at every level. */
  style: string;
  pace: string;
  tags: readonly TtsTag[];
}

export type NpcActivity = "work" | "eat" | "walk" | "chat" | "fish" | "read" | "rest" | "sleep";

/** One schedule point: from `at` (in-game `HH:MM`) the NPC heads to `place`. */
export interface SchedulePoint {
  at: string;
  place: PlaceId;
  activity: NpcActivity;
}

/**
 * How an NPC looks (build plan M07): one of the 16 animals with one of its natural fur tints,
 * shirt and trouser swatches from the clothing palette, and its own outfit, which is the
 * generated `outfit.<npc id>.glb` (apron for the Baker, sash and top hat for the Mayor,
 * glasses for the Librarian...). Mirrored by NPC_LOOKS in tools/blender/hvchars/outfits.py.
 */
export interface NpcLook {
  animal: AnimalId;
  furTint: string;
  shirt: SwatchId;
  trousers: SwatchId;
}

export type ProgressionBand = "beginner" | "elementary" | "intermediate" | "upper_intermediate" | "advanced";

/** The nine villagers, in the order of docs/hellovalley-village-npcs.md. */
export const NPC_IDS = [
  "shopkeeper",
  "baker",
  "barista",
  "farmer",
  "mayor",
  "librarian",
  "doctor",
  "gossip",
  "elder",
] as const;
export type NpcId = (typeof NPC_IDS)[number];
export const NpcIdSchema = z.enum(NPC_IDS);

export interface NpcDef {
  id: NpcId;
  englishName: string;
  /** Workplace, or home for the two residents. */
  building: BuildingId;
  progression: ProgressionBand;
  /**
   * Difficulty offset in half-CEFR steps (GDD §6.4): −2 = one full level easier, +1 = half a level
   * harder.
   */
  tierOffset: number;
  signature: string;
  look: NpcLook;
  voice: NpcVoice;
  likedItems: readonly ItemId[];
  dislikedItems: readonly ItemId[];
  /** 4–6 points per in-game day, in time order (GDD §4.3). The server walks NPCs along it (npc/life.ts, build plan M31). */
  schedule: readonly SchedulePoint[];
}

/** The nine villagers (docs/hellovalley-village-npcs.md). Persona prompts live in docs/prompts/npc-runtime.md. */
export const NPCS = [
  {
    id: "shopkeeper",
    englishName: "Shopkeeper",
    building: "general_store",
    progression: "elementary",
    tierOffset: 0,
    signature: "For you, my friend, a very special price!",
    look: { animal: "raccoon", furTint: "grey", shirt: "butter", trousers: "navy" },
    voice: {
      prebuiltVoice: "Puck",
      character: "Upbeat",
      style:
        'Charming, upbeat salesperson. Enthusiastic and persuasive, with a conspiratorial lowered tone when announcing a "special price".',
      pace: "Fast-medium, bright, rising intonation",
      tags: ["<short pause>", "<laugh>"],
    },
    likedItems: ["old_coin", "crystal_pebble", "gift_box"],
    dislikedItems: ["smooth_pebble", "cough_drops"],
    schedule: [
      { at: "07:00", place: "general_store", activity: "work" },
      { at: "12:00", place: "bakery", activity: "chat" },
      { at: "13:00", place: "general_store", activity: "work" },
      { at: "19:00", place: "town_square", activity: "walk" },
      { at: "22:00", place: "general_store", activity: "sleep" },
    ],
  },
  {
    id: "baker",
    englishName: "Baker",
    building: "bakery",
    progression: "beginner",
    tierOffset: -2,
    signature: "You look hungry, dear. Sit down.",
    look: { animal: "bear", furTint: "honey", shirt: "peach", trousers: "cream" },
    voice: {
      prebuiltVoice: "Sulafat",
      character: "Warm",
      style:
        "Warm, motherly and affectionate. Soft, reassuring and unhurried, like talking to a child who needs comfort.",
      pace: "Slow-medium, low-mid, gentle",
      tags: ["<breath>", "<laugh>"],
    },
    likedItems: ["wild_berries", "flower_bouquet", "butter"],
    dislikedItems: ["carp", "energy_tonic"],
    schedule: [
      { at: "06:00", place: "bakery", activity: "work" },
      { at: "12:00", place: "square_bench", activity: "eat" },
      { at: "13:00", place: "bakery", activity: "work" },
      { at: "18:00", place: "farm", activity: "chat" },
      { at: "21:00", place: "bakery", activity: "sleep" },
    ],
  },
  {
    id: "barista",
    englishName: "Barista",
    building: "cafe",
    progression: "intermediate",
    tierOffset: 0,
    signature: "You drink your coffee with sugar? Interesting choice.",
    look: { animal: "cat", furTint: "black", shirt: "cream", trousers: "charcoal" },
    voice: {
      prebuiltVoice: "Zubenelgenubi",
      character: "Casual",
      style:
        "Casual, dry and sarcastic. Relaxed, slightly bored delivery with ironic emphasis and a hint of pretension.",
      pace: "Medium, flat with sudden ironic lifts",
      tags: ["<sigh>", "<short pause>"],
    },
    likedItems: ["spiral_shell", "bluebell", "scented_candle"],
    dislikedItems: ["sugar", "cake"],
    schedule: [
      { at: "08:00", place: "cafe", activity: "work" },
      { at: "15:00", place: "library", activity: "read" },
      { at: "16:00", place: "cafe", activity: "work" },
      { at: "20:00", place: "bridge", activity: "walk" },
      { at: "23:00", place: "cafe", activity: "sleep" },
    ],
  },
  {
    id: "farmer",
    englishName: "Farmer",
    building: "farm",
    progression: "beginner",
    tierOffset: -2,
    signature: "Less talking. More working.",
    look: { animal: "dog", furTint: "red", shirt: "terracotta", trousers: "periwinkle" },
    voice: {
      prebuiltVoice: "Algenib",
      character: "Gravelly",
      style:
        "Gruff, laconic and plain-spoken. Short clipped sentences, no embellishment. Awkward softness only when sentimental.",
      pace: "Slow, low, minimal intonation",
      tags: ["<cough>", "<short pause>"],
    },
    likedItems: ["rye_bread", "fish_stew", "herb_seeds"],
    dislikedItems: ["scented_candle", "energy_tonic"],
    schedule: [
      { at: "05:00", place: "farm", activity: "work" },
      { at: "11:00", place: "bakery", activity: "eat" },
      { at: "12:00", place: "farm", activity: "work" },
      { at: "17:00", place: "town_hall", activity: "chat" },
      { at: "20:00", place: "farm", activity: "sleep" },
    ],
  },
  {
    id: "mayor",
    englishName: "Mayor",
    building: "town_hall",
    progression: "upper_intermediate",
    tierOffset: 1,
    signature: "This is a matter of great importance to our village!",
    look: { animal: "penguin", furTint: "black", shirt: "cream", trousers: "navy" },
    voice: {
      prebuiltVoice: "Fenrir",
      character: "Excitable",
      style:
        'Grandiose and theatrical, like a politician at a rally. Formal, over-articulated, dramatic emphasis on "important" words.',
      pace: "Medium-fast with dramatic slow-downs, wide pitch range",
      tags: ["<breath>", "<short pause>"],
    },
    likedItems: ["cake", "flower_bouquet", "gift_box"],
    dislikedItems: ["smooth_pebble", "button_mushroom"],
    schedule: [
      { at: "08:00", place: "town_hall", activity: "work" },
      { at: "10:00", place: "notice_board", activity: "work" },
      { at: "12:00", place: "cafe", activity: "eat" },
      { at: "14:00", place: "town_hall", activity: "work" },
      { at: "18:00", place: "fountain", activity: "walk" },
      { at: "22:00", place: "town_hall", activity: "sleep" },
    ],
  },
  {
    id: "librarian",
    englishName: "Librarian",
    building: "library",
    progression: "advanced",
    tierOffset: 2,
    signature: "Technically, that's not what that word means.",
    look: { animal: "owl", furTint: "tawny", shirt: "lavender", trousers: "charcoal" },
    voice: {
      prebuiltVoice: "Sadaltager",
      character: "Knowledgeable",
      style:
        "Precise, refined and slightly pedantic. Crisp diction, measured, with a faintly superior tone when correcting someone.",
      pace: "Medium, clear, controlled",
      tags: ["<sigh>", "<short pause>"],
    },
    likedItems: ["romance_novel", "old_letter", "tea"],
    dislikedItems: ["cinnamon_roll", "carp"],
    schedule: [
      { at: "09:00", place: "library", activity: "work" },
      { at: "13:00", place: "cafe", activity: "eat" },
      { at: "14:00", place: "library", activity: "work" },
      { at: "19:00", place: "library", activity: "read" },
      { at: "23:00", place: "library", activity: "sleep" },
    ],
  },
  {
    id: "doctor",
    englishName: "Doctor",
    building: "clinic",
    progression: "elementary",
    tierOffset: 0,
    signature: "Have you been sleeping properly? Don't lie to me.",
    look: { animal: "koala", furTint: "grey", shirt: "sky", trousers: "navy" },
    voice: {
      prebuiltVoice: "Schedar",
      character: "Even",
      style: "Calm, tired and analytical. Even, instructional tone with weary exasperation when advice is ignored.",
      pace: "Medium-slow, low-mid, steady",
      tags: ["<sigh>", "<breath>"],
    },
    likedItems: ["herbal_tea", "mint", "tea"],
    dislikedItems: ["cake", "cookie"],
    schedule: [
      { at: "07:30", place: "clinic", activity: "work" },
      { at: "12:30", place: "square_bench", activity: "eat" },
      { at: "13:00", place: "clinic", activity: "work" },
      { at: "19:00", place: "river_bank", activity: "walk" },
      { at: "21:30", place: "clinic", activity: "sleep" },
    ],
  },
  {
    id: "gossip",
    englishName: "Gossip",
    building: "gossip_house",
    progression: "intermediate",
    tierOffset: 0,
    signature: "Promise you won't tell anyone, but...",
    look: { animal: "rabbit", furTint: "snow", shirt: "blush", trousers: "lilac" },
    voice: {
      prebuiltVoice: "Sadachbia",
      character: "Lively",
      style: "Breathless, conspiratorial and theatrical. Whispered asides, gasps and rising questions.",
      pace: "Very fast, high, big dynamic swings",
      tags: ["<breath>", "<laugh>", "<short pause>"],
    },
    likedItems: ["cake", "cinnamon_roll", "old_letter"],
    dislikedItems: ["village_history", "herbal_tea"],
    schedule: [
      { at: "08:00", place: "square_bench", activity: "chat" },
      { at: "11:00", place: "general_store", activity: "chat" },
      { at: "12:00", place: "cafe", activity: "eat" },
      { at: "14:00", place: "square_bench", activity: "chat" },
      { at: "18:00", place: "clinic", activity: "chat" },
      { at: "22:00", place: "gossip_house", activity: "sleep" },
    ],
  },
  {
    id: "elder",
    englishName: "Elder",
    building: "elder_cottage",
    progression: "advanced",
    tierOffset: 2,
    signature: "Ah, that reminds me of the summer of '72...",
    look: { animal: "capybara", furTint: "tawny", shirt: "sand", trousers: "moss" },
    voice: {
      prebuiltVoice: "Gacrux",
      character: "Mature",
      style:
        "Slow, raspy storyteller with a mischievous twinkle. Poetic cadence, long pauses before punchlines, proverbs delivered like wisdom.",
      pace: "Slow, low, rhythmic",
      tags: ["<cough>", "<laugh>", "<short pause>"],
    },
    likedItems: ["tea", "old_coin", "mushroom_soup"],
    dislikedItems: ["energy_tonic", "coffee"],
    schedule: [
      { at: "05:30", place: "fishing_dock", activity: "fish" },
      { at: "11:00", place: "elder_cottage", activity: "rest" },
      { at: "14:00", place: "fishing_dock", activity: "fish" },
      { at: "18:00", place: "square_bench", activity: "chat" },
      { at: "21:00", place: "elder_cottage", activity: "sleep" },
    ],
  },
] as const satisfies readonly NpcDef[];

const BY_ID = new Map<string, NpcDef>(NPCS.map((n) => [n.id, n]));

export function isNpcId(value: unknown): value is NpcId {
  return typeof value === "string" && BY_ID.has(value);
}

export function getNpc(id: NpcId): NpcDef;
export function getNpc(id: string): NpcDef | undefined;
export function getNpc(id: string): NpcDef | undefined {
  return BY_ID.get(id);
}

export type NpcRelationshipKind = "rivals" | "secret_crush" | "bickering" | "enemies" | "friends" | "corrects";

/** Relationships from docs/hellovalley-village-npcs.md. NPC↔NPC barks use them (npc/ambient.ts, build plan M31). */
export const NPC_RELATIONSHIPS: readonly { a: NpcId; b: NpcId; kind: NpcRelationshipKind; note: string }[] = [
  { a: "shopkeeper", b: "baker", kind: "rivals", note: "Friendly business rivalry." },
  { a: "barista", b: "librarian", kind: "secret_crush", note: "Secretly attracted, both too proud to admit it." },
  { a: "farmer", b: "mayor", kind: "bickering", note: "Constantly arguing about unnecessary village projects." },
  { a: "doctor", b: "gossip", kind: "enemies", note: "Natural enemies because of patient confidentiality." },
  { a: "gossip", b: "elder", kind: "rivals", note: "Competing sources of village information, neither entirely reliable." },
  { a: "baker", b: "farmer", kind: "friends", note: "Long-time friends who care for each other without saying it." },
  { a: "librarian", b: "mayor", kind: "corrects", note: "The Librarian constantly corrects the Mayor's official announcements." },
];

/**
 * The schedule point in effect at `minuteOfDay` (0–1439). Before the first point of the day the
 * last point of the previous day still applies.
 */
export function schedulePointAt(npc: NpcDef, minuteOfDay: number): SchedulePoint | undefined {
  const points = npc.schedule;
  let current = points[points.length - 1];
  for (const point of points) {
    if ((clockToMinutes(point.at) ?? Infinity) <= minuteOfDay) current = point;
  }
  return current;
}
