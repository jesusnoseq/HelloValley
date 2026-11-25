import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ID_TOKEN_MAX_LENGTH } from "@hellovalley/shared";
import type { IdTokenVerifier, VerifiedUser } from "./idToken";

/** Set by `requireAuth` on every `/api/*` request that passed. */
export type AuthedLocals = { user: VerifiedUser };

/**
 * Express middleware for `/api/*` (architecture §7.2): requires `Authorization: Bearer <ID token>`
 * and verifies it with firebase-admin. The user is stored in `res.locals.user`.
 * TODO(M36): also require and verify `X-Firebase-AppCheck`.
 */
export function requireAuth(verifier: IdTokenVerifier): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // CORS preflights never carry credentials.
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    const match = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
    const token = match?.[1];
    if (!token || token.length > ID_TOKEN_MAX_LENGTH) {
      res.status(401).json({ error: "missing or malformed bearer token" });
      return;
    }
    verifier.verify(token).then(
      (user) => {
        (res.locals as AuthedLocals).user = user;
        next();
      },
      () => {
        res.status(401).json({ error: "invalid token" });
      },
    );
  };
}
