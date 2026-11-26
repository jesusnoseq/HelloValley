import { z } from "zod";
import { LanguageCodeSchema } from "../data/languages";

/**
 * `POST /api/review` (build plan M25): the client tells the server a review session finished on
 * the player's local day `day` (`localDayNumber`). `langs/{lang}.streak` is server-written
 * (architecture §8.1), so the server checks the day is plausible (within a day of UTC) and that
 * the notebook really has a card reviewed recently, then applies `nextStreak`.
 */
export const ReviewDoneRequestSchema = z.strictObject({
  lang: LanguageCodeSchema,
  day: z.number().int().min(0).max(1_000_000),
});
export type ReviewDoneRequest = z.infer<typeof ReviewDoneRequestSchema>;

export const ReviewDoneResponseSchema = z.object({
  streak: z.number().int().min(0),
  day: z.number().int().nullable(),
});
export type ReviewDoneResponse = z.infer<typeof ReviewDoneResponseSchema>;

export type ReviewDoneError = "invalid_request" | "implausible_day" | "not_found" | "no_review";

/** A review counts for the streak when a card was reviewed within this long (ms; my number). */
export const REVIEW_RECENT_MS = 36 * 60 * 60 * 1000;
