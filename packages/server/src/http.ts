import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { requireAuth } from "./auth/middleware";
import type { IdTokenVerifier } from "./auth/idToken";
import type { ProfileStore } from "./profiles/profileStore";
import { appearanceRouter } from "./routes/appearance";
import { onboardingRouter, type OnboardingDeps } from "./routes/onboarding";
import { shardsRouter } from "./routes/shards";
import type { TownRegistry } from "./rooms/townRegistry";

/** JSON bodies on /api are small (the onboarding and appearance requests are well under 1 KB). */
export const API_BODY_LIMIT = "8kb";

export interface HttpDeps {
  verifier: IdTokenVerifier;
  profiles: ProfileStore;
  onboarding?: Omit<OnboardingDeps, "profiles">;
  /** The live TownRoom shards (GET /api/shards, appearance pushes). */
  registry: TownRegistry;
}

/** Express routes served next to Colyseus in the same process (architecture §7.2). */
export function registerHttpRoutes(app: Application, deps: HttpDeps): void {
  // Fly.io liveness check. No auth.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Every /api/* request carries a Firebase ID token (App Check: TODO(M36)).
  app.use("/api", requireAuth(deps.verifier));
  app.use("/api", express.json({ limit: API_BODY_LIMIT }));
  app.use("/api", onboardingRouter({ ...deps.onboarding, profiles: deps.profiles }));
  app.use(
    "/api",
    appearanceRouter({ profiles: deps.profiles, onSaved: (uid, profile) => deps.registry.applyProfile(uid, profile) }),
  );
  app.use("/api", shardsRouter({ registry: deps.registry }));
  // TODO(M24/M37): POST /api/langs (add a target language).

  // Malformed JSON, oversized bodies and anything else thrown on /api answer with JSON.
  app.use("/api", (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = typeof err === "object" && err !== null && "status" in err ? Number(err.status) : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: "invalid_request" });
      return;
    }
    console.error("[api]", err);
    res.status(500).json({ error: "internal" });
  });
}
