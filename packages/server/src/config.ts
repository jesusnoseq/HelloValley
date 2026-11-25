/** Demo project used with the local emulators (`.firebaserc`). `demo-*` ids never reach production. */
export const DEMO_PROJECT_ID = "demo-hellovalley";
export const DEFAULT_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
export const DEFAULT_FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

export interface FirebaseConfig {
  projectId: string;
  /**
   * Auth emulator `host:port`, or null for real Firebase Auth. With the emulator, firebase-admin
   * accepts unsigned ID tokens, so it is only ever used with a `demo-*` project.
   */
  authEmulatorHost: string | null;
  /**
   * Firestore emulator `host:port`, or null for real Firestore (Admin SDK with Application Default
   * Credentials, i.e. `GOOGLE_APPLICATION_CREDENTIALS`). Like Auth, only with a `demo-*` project.
   */
  firestoreEmulatorHost: string | null;
}

export interface ServerConfig {
  port: number;
  host: string;
  firebase: FirebaseConfig;
}

/**
 * Reads the server config from the environment. Local dev defaults to 127.0.0.1:2567 and the
 * `demo-hellovalley` project on the Auth emulator.
 * TODO(M38): fly.toml sets PORT=8080, HOST=0.0.0.0 and FIREBASE_PROJECT_ID, and a Fly secret provides
 * the service account for GOOGLE_APPLICATION_CREDENTIALS (architecture §3.1).
 */
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 2567);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PORT: ${env.PORT}`);
  return { port, host: env.HOST || "127.0.0.1", firebase: readFirebaseConfig(env) };
}

export function readFirebaseConfig(env: NodeJS.ProcessEnv = process.env): FirebaseConfig {
  const projectId = env.FIREBASE_PROJECT_ID || DEMO_PROJECT_ID;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error(`Invalid FIREBASE_PROJECT_ID: ${projectId}`);
  const isDemo = projectId.startsWith("demo-");
  const emulatorHost = env.FIREBASE_AUTH_EMULATOR_HOST || null;
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST || null;
  // Never trust unsigned emulator tokens for a real project, nor write a real player's data to an emulator.
  if (emulatorHost && !isDemo) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST is set for a real project; use a demo-* project with the emulators");
  }
  if (firestoreHost && !isDemo) {
    throw new Error("FIRESTORE_EMULATOR_HOST is set for a real project; use a demo-* project with the emulators");
  }
  return {
    projectId,
    authEmulatorHost: isDemo ? (emulatorHost ?? DEFAULT_AUTH_EMULATOR_HOST) : null,
    firestoreEmulatorHost: isDemo ? (firestoreHost ?? DEFAULT_FIRESTORE_EMULATOR_HOST) : null,
  };
}
