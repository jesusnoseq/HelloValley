import { type App, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { FirebaseConfig } from "../config";

/** The identity behind a verified Firebase ID token. */
export interface VerifiedUser {
  uid: string;
  /** The `admin: true` custom claim (seeding tool, architecture §6.3). */
  admin: boolean;
}

export interface IdTokenVerifier {
  /** Resolves with the user for a valid token; rejects for anything else. */
  verify(idToken: string): Promise<VerifiedUser>;
}

/** Thrown for a missing, malformed, expired or otherwise invalid ID token. */
export class InvalidIdTokenError extends Error {
  constructor(cause?: unknown) {
    super("invalid Firebase ID token", { cause });
    this.name = "InvalidIdTokenError";
  }
}

const APP_NAME = "hellovalley-server";

/**
 * Verifies ID tokens with firebase-admin. Verification needs only the project id (Google's public
 * keys are fetched and cached by the SDK). With the Auth emulator the SDK accepts the emulator's
 * unsigned tokens instead; `readFirebaseConfig` allows that only for `demo-*` projects.
 * TODO(M14): initialize Firestore here with the service account credential (architecture §3.1).
 * TODO(M36): also verify App Check tokens.
 */
export function createFirebaseVerifier(config: FirebaseConfig): IdTokenVerifier {
  if (config.authEmulatorHost) process.env.FIREBASE_AUTH_EMULATOR_HOST = config.authEmulatorHost;
  const app: App =
    getApps().find((a) => a.name === APP_NAME) ?? initializeApp({ projectId: config.projectId }, APP_NAME);
  const auth = getAuth(app);
  return {
    async verify(idToken) {
      try {
        // TODO(M36): checkRevoked (needs the service account) for banned players.
        const decoded = await auth.verifyIdToken(idToken);
        return { uid: decoded.uid, admin: decoded.admin === true };
      } catch (err) {
        throw new InvalidIdTokenError(err);
      }
    },
  };
}
