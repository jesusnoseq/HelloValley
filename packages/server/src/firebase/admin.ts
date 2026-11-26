import { type App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import type { FirebaseConfig } from "../config";

const APP_NAME = "hellovalley-server";

/**
 * The server's one firebase-admin app. With the emulators (`demo-*` projects only, see
 * `readFirebaseConfig`) the SDK reads their hosts from the environment and needs no credential.
 * A real project uses the service account key from the `FIREBASE_SERVICE_ACCOUNT` Fly secret
 * (build plan M38, architecture §3.1), or else Application Default Credentials
 * (`GOOGLE_APPLICATION_CREDENTIALS`, gcloud), so it can write Firestore and verify tokens.
 */
export function adminApp(config: FirebaseConfig): App {
  if (config.authEmulatorHost) process.env.FIREBASE_AUTH_EMULATOR_HOST = config.authEmulatorHost;
  if (config.firestoreEmulatorHost) process.env.FIRESTORE_EMULATOR_HOST = config.firestoreEmulatorHost;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  const isEmulated = config.authEmulatorHost !== null || config.firestoreEmulatorHost !== null;
  if (isEmulated) return initializeApp({ projectId: config.projectId }, APP_NAME);
  const credential = config.serviceAccount ? cert(config.serviceAccount) : applicationDefault();
  return initializeApp({ projectId: config.projectId, credential }, APP_NAME);
}
