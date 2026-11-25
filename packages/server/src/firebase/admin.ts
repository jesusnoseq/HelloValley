import { type App, applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import type { FirebaseConfig } from "../config";

const APP_NAME = "hellovalley-server";

/**
 * The server's one firebase-admin app. With the emulators (`demo-*` projects only, see
 * `readFirebaseConfig`) the SDK reads their hosts from the environment and needs no credential.
 * A real project uses Application Default Credentials (the service account in
 * `GOOGLE_APPLICATION_CREDENTIALS`, a Fly secret: TODO(M38)) so it can write Firestore.
 */
export function adminApp(config: FirebaseConfig): App {
  if (config.authEmulatorHost) process.env.FIREBASE_AUTH_EMULATOR_HOST = config.authEmulatorHost;
  if (config.firestoreEmulatorHost) process.env.FIRESTORE_EMULATOR_HOST = config.firestoreEmulatorHost;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  const isEmulated = config.authEmulatorHost !== null || config.firestoreEmulatorHost !== null;
  return initializeApp(
    isEmulated ? { projectId: config.projectId } : { projectId: config.projectId, credential: applicationDefault() },
    APP_NAME,
  );
}
