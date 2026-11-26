import { z } from "zod";
import { AnimalIdSchema, isFurTintFor } from "../data/animals";
import type { ApartmentId } from "../data/apartment";
import { type Level, levelToStep } from "../data/difficulty";
import { getLanguage, LanguageCodeSchema } from "../data/languages";
import { StyleIdSchema } from "../data/styles";
import {
  AvatarColorsSchema,
  type LangProgress,
  LangProgressSchema,
  PlayerNameSchema,
  PlayerProfileSchema,
  type TimestampLike,
  type UserProfile,
  UserProfileSchema,
} from "../firestore/schemas";

/**
 * Onboarding (GDD §2.1, build plan M14): what the client sends to `POST /api/onboarding` and how
 * the server turns it into the `users/{uid}` and `users/{uid}/langs/{lang}` documents
 * (architecture §7.2). The server assigns the apartment and the starting coins; the client never
 * sends them (the request schema is strict).
 */

export const ApiRoute = {
  Onboarding: "/api/onboarding",
  /** `PUT`: the apartment mirror saves the avatar's appearance (build plan M15, avatar/appearance.ts). */
  Appearance: "/api/profile/appearance",
  /** `GET`: the TownRoom shards and a friend's shard (`?friend=<uid>`, build plan M16, protocol/schemas.ts). */
  Shards: "/api/shards",
  /** `POST`: a notebook review session finished; the server counts the day for the streak (build plan M25, srs/api.ts). */
  Review: "/api/review",
  /** `GET`: budget and abuse counters for operators (the `admin: true` claim, build plan M36, server metrics/metrics.ts). */
  Metrics: "/api/metrics",
  // TODO(M37): Langs: "/api/langs" (add a target language).
} as const;

/** GDD §2.1 step 4: five friendly self-assessments, each mapped to a starting CEFR level. */
export const SELF_ASSESSMENTS = [
  { id: "brand_new", level: "A1" },
  { id: "basics", level: "A2" },
  { id: "simple_chat", level: "B1" },
  { id: "comfortable", level: "B2" },
  { id: "fluent_ish", level: "C1" },
] as const satisfies readonly { id: string; level: Level }[];

export type SelfAssessment = (typeof SELF_ASSESSMENTS)[number]["id"];
export const SELF_ASSESSMENT_IDS = SELF_ASSESSMENTS.map((a) => a.id) as readonly SelfAssessment[];
export const SelfAssessmentSchema = z.enum(SELF_ASSESSMENT_IDS as [SelfAssessment, ...SelfAssessment[]]);

export function levelForSelfAssessment(id: SelfAssessment): Level {
  return SELF_ASSESSMENTS.find((a) => a.id === id)!.level;
}

/**
 * Coins a player starts with in each target language (architecture §7.2). My choice: enough for a
 * few loaves and coffees (shop prices are 2–20 coins), not enough to skip the early economy.
 */
export const STARTING_COINS = 50;

/** True when the two codes name the same language (case-insensitive, `pt-BR` = `pt-br`). */
function sameLanguage(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const OnboardingRequestSchema = z
  .strictObject({
    name: PlayerNameSchema,
    nativeLang: LanguageCodeSchema,
    targetLang: LanguageCodeSchema,
    selfAssessment: SelfAssessmentSchema,
    animal: AnimalIdSchema,
    colors: AvatarColorsSchema,
    style: StyleIdSchema,
  })
  .refine((r) => !sameLanguage(r.nativeLang, r.targetLang), {
    message: "the target language must differ from the native language",
    path: ["targetLang"],
  })
  .refine((r) => isFurTintFor(r.animal, r.colors.fur), {
    message: "fur tint does not belong to the animal",
    path: ["colors", "fur"],
  });
/** What the client builds (before parsing: HSL colours are clamped by the schema). */
export type OnboardingRequestInput = z.input<typeof OnboardingRequestSchema>;
export type OnboardingRequest = z.output<typeof OnboardingRequestSchema>;

/** `POST /api/onboarding` 200 body. `created` is false when the player had already onboarded. */
export const OnboardingResponseSchema = z.strictObject({
  created: z.boolean(),
  profile: PlayerProfileSchema,
});
export type OnboardingResponse = z.infer<typeof OnboardingResponseSchema>;

/** Error codes of `POST /api/onboarding` (4xx JSON body `{ error, message }`). */
export const ONBOARDING_ERRORS = ["invalid_request", "name_rejected"] as const;
export type OnboardingError = (typeof ONBOARDING_ERRORS)[number];
/** The 4xx/5xx JSON body of every `/api/*` route: `{ error, message? }`. */
export const ApiErrorBodySchema = z.object({
  error: z.string().max(64),
  message: z.string().max(500).optional(),
});
export const OnboardingErrorBodySchema = ApiErrorBodySchema;

/** Documents the server creates for a new player. */
export interface OnboardingRecords {
  profile: UserProfile;
  lang: { code: string; progress: LangProgress };
}

/**
 * Builds and validates the onboarding documents from a parsed request. The server passes the
 * apartment it drew (`randomApartmentId`) and the creation time.
 */
export function buildOnboardingRecords(
  request: OnboardingRequest,
  { apartmentId, now }: { apartmentId: ApartmentId; now: TimestampLike },
): OnboardingRecords {
  // Canonical casing, so the `langs/{lang}` document id matches LANGUAGES.
  const nativeLang = getLanguage(request.nativeLang)?.code ?? request.nativeLang;
  const targetLang = getLanguage(request.targetLang)?.code ?? request.targetLang;
  const level = levelForSelfAssessment(request.selfAssessment);
  const profile = UserProfileSchema.parse({
    name: request.name,
    animal: request.animal,
    colors: request.colors,
    apartmentId,
    nativeLang,
    targetLangs: [targetLang],
    style: request.style,
    createdAt: now,
  });
  const progress = LangProgressSchema.parse({
    level,
    // Gameplay adjusts the level from here (GDD §6.4, npc/levelAdaptation.ts).
    levelEstimate: levelToStep(level),
    streak: 0,
    coins: STARTING_COINS,
    hearts: {},
    settings: {},
  });
  return { profile, lang: { code: targetLang, progress } };
}
