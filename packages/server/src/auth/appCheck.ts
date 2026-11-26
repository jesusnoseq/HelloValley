import { getAppCheck } from "firebase-admin/app-check";
import type { FirebaseConfig } from "../config";
import { adminApp } from "../firebase/admin";

/**
 * App Check on the game server (build plan M36, architecture §7.2). The client attaches its App
 * Check token (reCAPTCHA Enterprise in production, a registered debug token in development) to
 * every `/api/*` request (`X-Firebase-AppCheck`) and to its room join options; the server verifies
 * it with the Admin SDK. AI Logic, Firestore and Storage check App Check themselves once it is
 * enforced in the console (build plan M38, docs/deploy.md).
 */
export interface AppCheckVerifier {
  /** Resolves for a valid token; rejects for anything else. */
  verify(token: string): Promise<void>;
}

export class InvalidAppCheckTokenError extends Error {
  constructor(cause?: unknown) {
    super("invalid Firebase App Check token", { cause });
    this.name = "InvalidAppCheckTokenError";
  }
}

/** Verifies tokens with firebase-admin (Google's public keys are fetched and cached by the SDK). */
export function createFirebaseAppCheckVerifier(config: FirebaseConfig): AppCheckVerifier {
  const appCheck = getAppCheck(adminApp(config));
  return {
    async verify(token) {
      try {
        await appCheck.verifyToken(token);
      } catch (err) {
        throw new InvalidAppCheckTokenError(err);
      }
    },
  };
}

export type AppCheckResult = "ok" | "missing" | "invalid";

/** Checks an optional token against an optional verifier (null = App Check is not enforced). */
export async function checkAppCheck(verifier: AppCheckVerifier | null, token: string | undefined): Promise<AppCheckResult> {
  if (!verifier) return "ok";
  if (!token) return "missing";
  try {
    await verifier.verify(token);
    return "ok";
  } catch {
    return "invalid";
  }
}
