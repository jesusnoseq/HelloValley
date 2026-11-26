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
  /**
   * The service account key for a real project (build plan M38, architecture §3.1): Fly.io has no
   * Google default credentials, so the key arrives as the `FIREBASE_SERVICE_ACCOUNT` secret. Absent
   * means Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, gcloud) or the emulators.
   */
  serviceAccount?: ServiceAccountKey;
}

/** The fields of a Google service account JSON key that firebase-admin's `cert()` needs. */
export interface ServiceAccountKey {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  firebase: FirebaseConfig;
}

/**
 * Reads the server config from the environment. Local dev defaults to 127.0.0.1:2567 and the
 * `demo-hellovalley` project on the Auth emulator.
 * In production (build plan M38, `fly.toml`) PORT=8080 and HOST=0.0.0.0, and the Fly secrets
 * `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT` select the real project (architecture §3.1).
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
  const serviceAccount = isDemo ? null : readServiceAccount(env);
  if (serviceAccount && serviceAccount.projectId !== projectId) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT belongs to ${serviceAccount.projectId}, not FIREBASE_PROJECT_ID ${projectId}`);
  }
  return {
    projectId,
    authEmulatorHost: isDemo ? (emulatorHost ?? DEFAULT_AUTH_EMULATOR_HOST) : null,
    firestoreEmulatorHost: isDemo ? (firestoreHost ?? DEFAULT_FIRESTORE_EMULATOR_HOST) : null,
    ...(serviceAccount ? { serviceAccount } : {}),
  };
}

/**
 * `FIREBASE_SERVICE_ACCOUNT`: the service account JSON key, as JSON or base64 of the JSON (a Fly
 * secret, `fly secrets set FIREBASE_SERVICE_ACCOUNT="$(base64 -w0 key.json)"`). Null when unset.
 * Errors never echo the value, which is a private key.
 */
export function readServiceAccount(env: NodeJS.ProcessEnv = process.env): ServiceAccountKey | null {
  const raw = env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not a JSON key (raw or base64)");
  }
  const key = (parsed ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof key[k] === "string" && key[k] !== "" ? (key[k] as string) : null);
  const projectId = str("project_id");
  const clientEmail = str("client_email");
  const privateKey = str("private_key");
  if (key.type !== "service_account" || !projectId || !clientEmail || !privateKey) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT must be a service account key (type, project_id, client_email, private_key)");
  }
  return { projectId, clientEmail, privateKey };
}

/**
 * App Check on the game server (build plan M36, architecture §7.2): whether `/api/*` requests and
 * room joins must carry a valid App Check token. `APP_CHECK=enforce|off`; by default it is enforced
 * for a real project and off for the `demo-*` emulator project (App Check has no emulator).
 */
export function readAppCheckEnforced(env: NodeJS.ProcessEnv, firebase: Pick<FirebaseConfig, "projectId">): boolean {
  const mode = env.APP_CHECK?.trim().toLowerCase();
  if (mode === "enforce") return true;
  if (mode === "off") return false;
  if (mode) throw new Error(`Invalid APP_CHECK: ${env.APP_CHECK} (use "enforce" or "off")`);
  return !firebase.projectId.startsWith("demo-");
}
