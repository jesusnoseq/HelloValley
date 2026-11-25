import type { Application } from "express";

/** Express routes served next to Colyseus in the same process (architecture §7.2). */
export function registerHttpRoutes(app: Application): void {
  // Fly.io liveness check. No auth.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // TODO(M03): auth middleware for /api/* (Firebase ID token + App Check, both verified with the Admin SDK).
  // TODO(M14): POST /api/onboarding, POST /api/langs.
  // TODO(M16): GET /api/shards.
}
