import { z } from "zod";
import { APARTMENT_MAX_PLACED, APARTMENT_MAX_STORED } from "../apartment/layout";
import { FURNITURE_IDS } from "../apartment/furniture";
import { AnimalIdSchema, isFurTintFor } from "../data/animals";
import { ApartmentIdSchema } from "../data/apartment";
import { LevelSchema, MAX_LEVEL_STEP } from "../data/difficulty";
import { ItemIdSchema } from "../data/items";
import { LanguageCodeSchema } from "../data/languages";
import { NpcIdSchema } from "../data/npcs";
import { ClothingColorSchema } from "../data/palette";
import { StyleIdSchema } from "../data/styles";
import { SCRIPT_MODES } from "../language/scriptMode";
import { CHAT_REPORT_REASONS } from "../protocol/messages";

/**
 * Zod schemas for the Firestore documents in GDD §9.4 (with the ownership in architecture §8.1).
 * Every document read from Firestore is parsed with these before use, and every client write is
 * built from them. The limits are mirrored in `firestore.rules`; keep the two in sync.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** GDD §3.3: display names are 2–16 characters (and moderated by the server at onboarding). */
export const PLAYER_NAME_MIN_LENGTH = 2;
export const PLAYER_NAME_MAX_LENGTH = 16;
/** A player learns at most this many target languages at once. */
export const MAX_TARGET_LANGS = 10;
/** GDD §8.2: friendship is 0–10 hearts per NPC. */
export const MAX_HEARTS = 10;
/** GDD §8.2 / architecture §6.1: memory summaries are capped at 120 words and 10 facts. */
export const NPC_MEMORY_MAX_WORDS = 120;
export const NPC_MEMORY_MAX_FACTS = 10;
export const NPC_MEMORY_FACT_MAX_LENGTH = 200;
/** Notebook field limits (characters). */
export const NOTEBOOK_SURFACE_MAX_LENGTH = 200;
export const NOTEBOOK_TEXT_MAX_LENGTH = 500;
/** GDD §9.4: village events live for 14 days (Firestore TTL policy on `expiresAt`). */
export const VILLAGE_EVENT_TTL_DAYS = 14;

/**
 * A Firestore `Timestamp`, from either the web SDK or the Admin SDK. Both expose `seconds` and
 * `nanoseconds`, so the check is structural and `shared` needs no Firebase dependency.
 */
export interface TimestampLike {
  readonly seconds: number;
  readonly nanoseconds: number;
}

export const TimestampSchema = z.custom<TimestampLike>(
  (v) =>
    typeof v === "object" &&
    v !== null &&
    Number.isInteger((v as TimestampLike).seconds) &&
    Number.isInteger((v as TimestampLike).nanoseconds),
  { message: "expected a Firestore Timestamp" },
);

export const PlayerNameSchema = z
  .string()
  .trim()
  .min(PLAYER_NAME_MIN_LENGTH)
  .max(PLAYER_NAME_MAX_LENGTH)
  .refine((t) => !CONTROL_CHARS.test(t), { message: "name must not contain control characters" });

/** Avatar colours (GDD §3.3): a natural fur tint of the chosen animal, plus shirt and trousers. */
export const AvatarColorsSchema = z.strictObject({
  fur: z.string().min(1).max(32),
  shirt: ClothingColorSchema,
  trousers: ClothingColorSchema,
});
export type AvatarColors = z.infer<typeof AvatarColorsSchema>;

const userProfileShape = {
  name: PlayerNameSchema,
  animal: AnimalIdSchema,
  colors: AvatarColorsSchema,
  /** Assigned by the server at onboarding; never written by the client. */
  apartmentId: ApartmentIdSchema,
  /** The language glosses and translations are shown in. */
  nativeLang: LanguageCodeSchema,
  /** Added through `POST /api/langs` (server), which also creates `langs/{lang}`. */
  targetLangs: z.array(LanguageCodeSchema).min(1).max(MAX_TARGET_LANGS),
  style: StyleIdSchema,
  createdAt: TimestampSchema,
};

const furMatchesAnimal = (p: { animal?: string; colors?: { fur: string } }) =>
  p.animal === undefined || p.colors === undefined || isFurTintFor(p.animal, p.colors.fur);
const furMatchesAnimalIssue = { message: "fur tint does not belong to the animal", path: ["colors", "fur"] };

/** `users/{uid}`: created by the server at onboarding (`POST /api/onboarding`). */
export const UserProfileSchema = z.strictObject(userProfileShape).refine(furMatchesAnimal, furMatchesAnimalIssue);
export type UserProfile = z.infer<typeof UserProfileSchema>;

const { createdAt: _createdAt, ...playerProfileShape } = userProfileShape;

/**
 * The profile as the game uses it: `users/{uid}` without the Firestore-only `createdAt`. It is what
 * `POST /api/onboarding` returns (JSON has no Timestamp) and what the client keeps in memory.
 */
export const PlayerProfileSchema = z.strictObject(playerProfileShape).refine(furMatchesAnimal, furMatchesAnimalIssue);
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export function toPlayerProfile(profile: UserProfile): PlayerProfile {
  const { createdAt: _ignored, ...rest } = profile;
  return rest;
}

/**
 * The only `users/{uid}` fields a client may change (architecture §8.1): appearance, style and
 * native language. `name` (moderated), `apartmentId`, `targetLangs` and `createdAt` go through the
 * server. `firestore.rules` enforces the same list.
 */
export const USER_PROFILE_CLIENT_FIELDS = ["animal", "colors", "nativeLang", "style"] as const;

export const UserProfileClientUpdateSchema = z
  .strictObject({
    animal: userProfileShape.animal,
    colors: userProfileShape.colors,
    nativeLang: userProfileShape.nativeLang,
    style: userProfileShape.style,
  })
  .partial()
  .refine(furMatchesAnimal, furMatchesAnimalIssue);
export type UserProfileClientUpdate = z.infer<typeof UserProfileClientUpdateSchema>;

/** GDD §6.1 script toggle: native only, native + reading, or romanized only (language/scriptMode). */
export const ScriptModeSchema = z.enum(SCRIPT_MODES);

/** Per-language settings, the only `langs/{lang}` field a client may write. */
export const LangSettingsSchema = z.strictObject({
  scriptMode: ScriptModeSchema.optional(),
});
export type LangSettings = z.infer<typeof LangSettingsSchema>;

export const LANG_PROGRESS_CLIENT_FIELDS = ["settings"] as const;

/** `users/{uid}/langs/{lang}`: progress and economy for one target language (server-written). */
export const LangProgressSchema = z.strictObject({
  level: LevelSchema,
  /** Continuous estimate on the half-step scale (0 = A1 … MAX_LEVEL_STEP = C2). */
  levelEstimate: z.number().min(0).max(MAX_LEVEL_STEP),
  streak: z.number().int().min(0),
  coins: z.number().int().min(0),
  hearts: z.partialRecord(NpcIdSchema, z.number().min(0).max(MAX_HEARTS)),
  settings: LangSettingsSchema,
});
export type LangProgress = z.infer<typeof LangProgressSchema>;

/**
 * Where a notebook word was saved from (GDD §6.3): `npc:<npcId>`, `object:<labelKey>` or `chat`.
 */
export const NotebookSourceSchema = z.string().regex(/^(npc:[a-z0-9_-]{1,64}|object:[a-z0-9_.-]{1,64}|chat)$/);

const notebookText = z.string().max(NOTEBOOK_TEXT_MAX_LENGTH);

/** `users/{uid}/langs/{lang}/notebook/{entryId}`: written by the client (architecture §8.1). */
export const NotebookEntrySchema = z.strictObject({
  surface: z.string().trim().min(1).max(NOTEBOOK_SURFACE_MAX_LENGTH),
  lemma: notebookText.optional(),
  reading: notebookText.optional(),
  gloss: notebookText.optional(),
  example: notebookText.optional(),
  source: NotebookSourceSchema,
  /** Content hash of the audio clip, when there is one. */
  audioHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** FSRS card state. TODO(M25): replace with the FSRS card schema. */
  fsrs: z.record(z.string().max(32), z.union([z.number(), z.string().max(32), z.null()])).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema.optional(),
});
export type NotebookEntry = z.infer<typeof NotebookEntrySchema>;

/** `users/{uid}/langs/{lang}/npcMemory/{npcId}`: server-written (GDD §8.2). */
export const NpcMemorySchema = z.strictObject({
  summary: z
    .string()
    .max(NPC_MEMORY_MAX_WORDS * 12)
    .refine((s) => s.trim() === "" || s.trim().split(/\s+/).length <= NPC_MEMORY_MAX_WORDS, {
      message: `summary must be at most ${NPC_MEMORY_MAX_WORDS} words`,
    }),
  facts: z.array(z.string().max(NPC_MEMORY_FACT_MAX_LENGTH)).max(NPC_MEMORY_MAX_FACTS),
  lastSeen: TimestampSchema,
});
export type NpcMemory = z.infer<typeof NpcMemorySchema>;

/** `users/{uid}/inventory/{slot}`: server-written. TODO(M26): slot count and stack limits. */
export const InventorySlotSchema = z.strictObject({
  itemId: ItemIdSchema,
  qty: z.number().int().min(1),
});
export type InventorySlot = z.infer<typeof InventorySlotSchema>;

/** Furniture rotation in quarter turns (degrees). */
export const FurnitureRotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);

/** A piece of apartment furniture: a studio piece or shop furniture (apartment/furniture.ts). */
export const FurnitureIdSchema = z.enum(FURNITURE_IDS);

/** Room coordinates of a piece (the studio is 6 × 5 m; finer checks are `layoutProblems`). */
const roomCoord = z.number().min(0).max(12);

/**
 * `users/{uid}/apartment/layout`: server-written (the ApartmentRoom, build plan M17). The shape
 * is checked here; the placement rules (grid, walls, overlaps, built-ins, reachability) are
 * `layoutProblems` in apartment/layout.ts, which the server runs before every save. `stored` holds
 * the pieces put away in placement mode (missing in a document means none).
 */
export const ApartmentLayoutSchema = z.strictObject({
  furniture: z
    .array(
      z.strictObject({
        itemId: FurnitureIdSchema,
        x: roomCoord,
        z: roomCoord,
        rot: FurnitureRotationSchema,
      }),
    )
    .max(APARTMENT_MAX_PLACED),
  stored: z.array(FurnitureIdSchema).max(APARTMENT_MAX_STORED).default([]),
});
export type ApartmentLayout = z.infer<typeof ApartmentLayoutSchema>;

/** Firebase uids (the protocol's `UidSchema`; repeated here to keep the modules acyclic). */
const uidField = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/** Display names as stored on reports and block lists (not re-validated: names can be renamed). */
const nameField = z.string().min(1).max(64);

/** Most players one player can block (my number). */
export const MAX_BLOCKED_PLAYERS = 200;

/**
 * `users/{uid}/safety/blocks`: whom the player blocked (build plan M18, architecture §6.4).
 * Server-only: no rule matches the path, so clients cannot read or write it; the TownRoom sends
 * the list to its owner (`chat:safety`).
 */
export const BlockListSchema = z.strictObject({
  players: z.array(z.strictObject({ uid: uidField, name: nameField })).max(MAX_BLOCKED_PLAYERS),
});
export type BlockList = z.infer<typeof BlockListSchema>;

/** Lines of the reported player attached to a report, newest last (the server's own copies). */
export const REPORT_MAX_MESSAGES = 5;

/** The fields of a `reports/{id}` document the game server fills in (`createdAt` is added on write). */
export const ChatReportInputSchema = z.strictObject({
  kind: z.literal("chat"),
  reporterUid: uidField,
  reportedUid: uidField,
  reportedName: nameField,
  reason: z.enum(CHAT_REPORT_REASONS),
  /** The reported line, when the report named one. */
  messageId: z.string().max(64).optional(),
  /** Shard number ("Valley #n") where it happened. */
  shard: z.number().int().min(1),
  messages: z
    .array(
      z.strictObject({
        id: z.string().max(64),
        text: z.string().max(400),
        lang: z.string().max(32),
        ts: z.number().int().min(0),
      }),
    )
    .max(REPORT_MAX_MESSAGES),
});
export type ChatReportInput = z.infer<typeof ChatReportInputSchema>;

/** `reports/{id}`: a player report, server-written, never readable by clients (architecture §6.4). */
export const ChatReportDocSchema = ChatReportInputSchema.extend({ createdAt: TimestampSchema });
export type ChatReportDoc = z.infer<typeof ChatReportDocSchema>;

/** `village/{shardId}/events/{id}`: public game events, server-written (GDD §8.2). */
export const VillageEventSchema = z.strictObject({
  /** TODO(M31): an enum of event types. */
  type: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  actorName: PlayerNameSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
  ts: TimestampSchema,
  /** The TTL policy deletes the event after this time (ts + VILLAGE_EVENT_TTL_DAYS). */
  expiresAt: TimestampSchema,
});
export type VillageEvent = z.infer<typeof VillageEventSchema>;

/** `cache/lines/{hash}`: a seeded NPC line (admin seeding tool only, architecture §6.3). */
export const CachedLineSchema = z.strictObject({
  text: z.string().min(1).max(2000),
  reading: z.string().max(4000).optional(),
  tokens: z.array(z.string().max(100)).max(400).optional(),
  translation: z.record(LanguageCodeSchema, z.string().max(4000)).optional(),
});
export type CachedLine = z.infer<typeof CachedLineSchema>;

/** `cache/tts/{hash}`: points at a seeded Storage clip (`tts/{hash}.ogg`). */
export const CachedTtsSchema = z.strictObject({
  storagePath: z.string().regex(/^tts\/[0-9a-f]{64}\.ogg$/),
  voice: z.string().min(1).max(64),
  durationMs: z.number().int().min(0),
});
export type CachedTts = z.infer<typeof CachedTtsSchema>;

/** `cache/labels/{lang}`: world labels for one language, keyed by label key. */
export const CachedLabelsSchema = z.record(
  z.string().max(128),
  z.strictObject({
    word: z.string().min(1).max(200),
    reading: z.string().max(400).optional(),
    audioHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  }),
);
export type CachedLabels = z.infer<typeof CachedLabelsSchema>;
