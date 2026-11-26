import { getAuth } from "firebase-admin/auth";
import type { FirebaseConfig } from "../config";
import { adminApp } from "../firebase/admin";

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

/**
 * Verifies ID tokens with firebase-admin. Verification needs only the project id (Google's public
 * keys are fetched and cached by the SDK). With the Auth emulator the SDK accepts the emulator's
 * unsigned tokens instead; `readFirebaseConfig` allows that only for `demo-*` projects.
 * App Check tokens are verified separately (`appCheck.ts`, build plan M36). With a real project
 * the token is also checked for revocation, so disabling or signing out a banned account in
 * Firebase Auth locks it out of the API and the rooms at once (one Auth lookup per verify).
 */
export function createFirebaseVerifier(config: FirebaseConfig): IdTokenVerifier {
  const auth = getAuth(adminApp(config));
  // Revocation needs the Auth backend (the service account in production); the emulator has no bans.
  const checkRevoked = config.authEmulatorHost === null;
  return {
    async verify(idToken) {
      try {
        const decoded = await auth.verifyIdToken(idToken, checkRevoked);
        return { uid: decoded.uid, admin: decoded.admin === true };
      } catch (err) {
        throw new InvalidIdTokenError(err);
      }
    },
  };
}
