import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ID_TOKEN_MAX_LENGTH } from "@hellovalley/shared";
import type { ServerMetrics } from "../metrics/metrics";
import { type AppCheckVerifier, checkAppCheck } from "./appCheck";
import type { IdTokenVerifier, VerifiedUser } from "./idToken";

/** Set by `requireAuth` on every `/api/*` request that passed. */
export type AuthedLocals = { user: VerifiedUser };

/** The App Check header the web SDK's token goes in (architecture §7.2). */
export const APP_CHECK_HEADER = "X-Firebase-AppCheck";

/**
 * Express middleware for `/api/*` (architecture §7.2): requires `Authorization: Bearer <ID token>`
 * and verifies it with firebase-admin; with App Check enforced (build plan M36) it also requires
 * and verifies `X-Firebase-AppCheck`. The user is stored in `res.locals.user`.
 */
export function requireAuth(verifier: IdTokenVerifier, appCheck: AppCheckVerifier | null = null, metrics?: ServerMetrics): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // CORS preflights never carry credentials.
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    const match = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
    const token = match?.[1];
    if (!token || token.length > ID_TOKEN_MAX_LENGTH) {
      metrics?.inc("auth.idToken.rejected");
      res.status(401).json({ error: "missing or malformed bearer token" });
      return;
    }
    const appCheckToken = req.get(APP_CHECK_HEADER);
    Promise.all([verifier.verify(token), checkAppCheck(appCheck, appCheckToken && appCheckToken.length <= ID_TOKEN_MAX_LENGTH ? appCheckToken : undefined)]).then(
      ([user, app]) => {
        if (app !== "ok") {
          metrics?.inc(app === "missing" ? "auth.appCheck.missing" : "auth.appCheck.rejected");
          res.status(401).json({ error: "app_check" });
          return;
        }
        (res.locals as AuthedLocals).user = user;
        next();
      },
      () => {
        metrics?.inc("auth.idToken.rejected");
        res.status(401).json({ error: "invalid token" });
      },
    );
  };
}

/** After `requireAuth`: only the `admin: true` custom claim (the seeding tool's and operators' accounts). */
export function requireAdmin(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    if ((res.locals as Partial<AuthedLocals>).user?.admin !== true) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
