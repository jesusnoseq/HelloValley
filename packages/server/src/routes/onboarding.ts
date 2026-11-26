import { type Request, type Response, Router } from "express";
import {
  type ApartmentId,
  buildOnboardingRecords,
  type OnboardingError,
  OnboardingRequestSchema,
  type OnboardingResponse,
  randomApartmentId,
  type TimestampLike,
  toPlayerProfile,
} from "@hellovalley/shared";
import { Timestamp } from "firebase-admin/firestore";
import type { AuthedLocals } from "../auth/middleware";
import { moderateName, type NameModerator } from "../moderation/names";
import type { ProfileStore } from "../profiles/profileStore";

export interface OnboardingDeps {
  profiles: ProfileStore;
  moderateName?: NameModerator;
  /** Draws the apartment (GDD §4.2: random, uniqueness not required). Injected in tests. */
  drawApartment?: () => ApartmentId;
  now?: () => TimestampLike;
  /** Counts rejected names in the server metrics (build plan M36). */
  onNameRejected?: () => void;
}

function fail(res: Response, status: number, error: OnboardingError | "internal", message?: string): void {
  res.status(status).json(message ? { error, message } : { error });
}

/**
 * `POST /api/onboarding` (architecture §7.2): validates the request with the shared schema,
 * moderates the name, assigns `apartmentId` and the starting coins, and creates `users/{uid}` and
 * `users/{uid}/langs/{lang}` with the Admin SDK. Runs behind `requireAuth`, so the uid comes from
 * the verified ID token, never from the body.
 */
export function onboardingRouter(deps: OnboardingDeps): Router {
  const moderate = deps.moderateName ?? moderateName;
  const drawApartment = deps.drawApartment ?? (() => randomApartmentId());
  const now = deps.now ?? (() => Timestamp.now());
  const router = Router();

  router.post("/onboarding", async (req: Request, res: Response) => {
    const { uid } = (res.locals as AuthedLocals).user;
    const parsed = OnboardingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      fail(res, 400, "invalid_request", first ? `${first.path.join(".") || "body"}: ${first.message}` : undefined);
      return;
    }
    try {
      // Re-submitting after a successful onboarding returns the stored profile, so check first:
      // a name that the moderation would now reject must not block an existing player.
      const existing = await deps.profiles.getProfile(uid);
      if (existing) {
        const body: OnboardingResponse = { created: false, profile: toPlayerProfile(existing) };
        res.json(body);
        return;
      }
      const verdict = await moderate(parsed.data.name);
      if (!verdict.ok) {
        deps.onNameRejected?.();
        fail(res, 422, "name_rejected");
        return;
      }
      const records = buildOnboardingRecords(parsed.data, { apartmentId: drawApartment(), now: now() });
      const { created, profile } = await deps.profiles.createProfile(uid, records);
      const body: OnboardingResponse = { created, profile: toPlayerProfile(profile) };
      res.status(created ? 201 : 200).json(body);
    } catch (err) {
      console.error(`[api] onboarding failed for ${uid}:`, err);
      fail(res, 500, "internal");
    }
  });

  return router;
}
