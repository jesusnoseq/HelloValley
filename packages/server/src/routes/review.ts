import { type Request, type Response, Router } from "express";
import {
  ApiRoute,
  isPlausibleLocalDay,
  REVIEW_RECENT_MS,
  type ReviewDoneError,
  ReviewDoneRequestSchema,
  type ReviewDoneResponse,
} from "@hellovalley/shared";
import type { AuthedLocals } from "../auth/middleware";
import type { StreakStore } from "../notebook/streakStore";

export interface ReviewDeps {
  streaks: StreakStore;
  now?: () => number;
}

const PATH = ApiRoute.Review.replace(/^\/api/, "");

function fail(res: Response, status: number, error: ReviewDoneError | "internal"): void {
  res.status(status).json({ error });
}

/**
 * `POST /api/review` (build plan M25): a notebook review session finished. The body names the
 * target language and the player's local day; the server counts the day for `langs/{lang}.streak`
 * when it is within a day of UTC and the notebook has a card reviewed in the last 36 hours.
 */
export function reviewRouter(deps: ReviewDeps): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  router.post(PATH, async (req: Request, res: Response) => {
    const { uid } = (res.locals as AuthedLocals).user;
    const parsed = ReviewDoneRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      fail(res, 400, "invalid_request");
      return;
    }
    const t = now();
    if (!isPlausibleLocalDay(parsed.data.day, t)) {
      fail(res, 400, "implausible_day");
      return;
    }
    try {
      const result = await deps.streaks.recordReview(uid, parsed.data.lang, parsed.data.day, t - REVIEW_RECENT_MS);
      if (!result.ok) {
        fail(res, result.reason === "not_found" ? 404 : 409, result.reason);
        return;
      }
      const body: ReviewDoneResponse = { streak: result.state.streak, day: result.state.day };
      res.json(body);
    } catch (err) {
      console.error(`[api] review streak failed for ${uid}:`, err);
      fail(res, 500, "internal");
    }
  });
  return router;
}
