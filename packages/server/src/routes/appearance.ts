import { type Request, type Response, Router } from "express";
import {
  ApiRoute,
  type AppearanceError,
  AppearanceUpdateRequestSchema,
  type AppearanceUpdateResponse,
  toPlayerProfile,
} from "@hellovalley/shared";
import type { AuthedLocals } from "../auth/middleware";
import type { ProfileStore } from "../profiles/profileStore";

export interface AppearanceDeps {
  profiles: ProfileStore;
}

function fail(res: Response, status: number, error: AppearanceError | "internal", message?: string): void {
  res.status(status).json(message ? { error, message } : { error });
}

/** Path of the route under the `/api` mount. */
const PATH = ApiRoute.Appearance.replace(/^\/api/, "");

/**
 * `PUT /api/profile/appearance` (build plan M15): the apartment mirror saves the avatar's animal,
 * fur, shirt and trousers. The body is parsed with the shared `AppearanceUpdateRequestSchema`
 * (strict, so the name, apartment or economy fields cannot ride along; custom HSL colours are
 * clamped to the pastel range; the fur tint must belong to the animal) and written with the Admin
 * SDK to the caller's own `users/{uid}` (the uid comes from the verified ID token).
 * TODO(M16): tell the player's TownRoom so the room state shows the new look to everyone.
 */
export function appearanceRouter(deps: AppearanceDeps): Router {
  const router = Router();
  router.put(PATH, async (req: Request, res: Response) => {
    const { uid } = (res.locals as AuthedLocals).user;
    const parsed = AppearanceUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      fail(res, 400, "invalid_request", first ? `${first.path.join(".") || "body"}: ${first.message}` : undefined);
      return;
    }
    try {
      const profile = await deps.profiles.updateAppearance(uid, parsed.data);
      if (!profile) {
        fail(res, 404, "not_onboarded");
        return;
      }
      const body: AppearanceUpdateResponse = { profile: toPlayerProfile(profile) };
      res.json(body);
    } catch (err) {
      console.error(`[api] appearance update failed for ${uid}:`, err);
      fail(res, 500, "internal");
    }
  });
  return router;
}
