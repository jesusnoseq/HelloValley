import type { Application } from "express";
import { requireAuth } from "./auth/middleware";
import type { IdTokenVerifier } from "./auth/idToken";

/** Express routes served next to Colyseus in the same process (architecture §7.2). */
export function registerHttpRoutes(app: Application, verifier: IdTokenVerifier): void {
  // Fly.io liveness check. No auth.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Every /api/* request carries a Firebase ID token (App Check: TODO(M36)).
  app.use("/api", requireAuth(verifier));
  // TODO(M14): POST /api/onboarding, POST /api/langs.
  // TODO(M16): GET /api/shards.
}
