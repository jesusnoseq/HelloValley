import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { ApiRoute } from "@hellovalley/shared";
import { requireAdmin, requireAuth } from "./auth/middleware";
import type { AppCheckVerifier } from "./auth/appCheck";
import type { IdTokenVerifier } from "./auth/idToken";
import type { ServerMetrics } from "./metrics/metrics";
import type { ProfileStore } from "./profiles/profileStore";
import { appearanceRouter } from "./routes/appearance";
import type { StreakStore } from "./notebook/streakStore";
import { onboardingRouter, type OnboardingDeps } from "./routes/onboarding";
import { reviewRouter } from "./routes/review";
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
  /** The notebook review streak (POST /api/review, build plan M25). */
  streaks: StreakStore;
  /** App Check verification (build plan M36); null when not enforced (the emulator setup). */
  appCheck?: AppCheckVerifier | null;
  /** Budget and abuse counters, served at GET /api/metrics (build plan M36). */
  metrics?: ServerMetrics;
}

/** Express routes served next to Colyseus in the same process (architecture §7.2). */
export function registerHttpRoutes(app: Application, deps: HttpDeps): void {
  // Fly.io liveness check. No auth.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Every /api/* request carries a Firebase ID token and, when enforced, an App Check token (build plan M36).
  app.use("/api", requireAuth(deps.verifier, deps.appCheck ?? null, deps.metrics));
  app.use("/api", express.json({ limit: API_BODY_LIMIT }));
  // Build plan M36: budget and abuse counters, for operators (the `admin: true` claim) only.
  const metrics = deps.metrics;
  if (metrics) {
    app.get(ApiRoute.Metrics, requireAdmin(), (_req, res) => {
      res.set("cache-control", "no-store").json(metrics.snapshot());
    });
  }
  app.use("/api", onboardingRouter({ ...deps.onboarding, profiles: deps.profiles, ...(metrics ? { onNameRejected: () => metrics.inc("names.rejected") } : {}) }));
  app.use(
    "/api",
    appearanceRouter({ profiles: deps.profiles, onSaved: (uid, profile) => deps.registry.applyProfile(uid, profile) }),
  );
  app.use("/api", shardsRouter({ registry: deps.registry }));
  app.use("/api", reviewRouter({ streaks: deps.streaks }));
  // TODO(M37): POST /api/langs (add a target language).

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
