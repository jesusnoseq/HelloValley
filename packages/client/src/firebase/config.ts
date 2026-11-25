import type { FirebaseOptions } from "firebase/app";

/** Demo project used with the local emulators (`.firebaserc`). `demo-*` ids never reach production. */
export const DEMO_PROJECT_ID = "demo-hellovalley";

export interface EmulatorHosts {
  auth: string;
  firestore: { host: string; port: number };
  storage: { host: string; port: number };
}

export interface ClientFirebaseConfig {
  options: FirebaseOptions;
  /** Set when the app talks to the local emulator suite (`firebase.json` ports). */
  emulators: EmulatorHosts | null;
}

type Env = Partial<Record<keyof ImportMetaEnv, string | undefined>>;

const hostPort = (value: string | undefined, fallback: string) => {
  const [host = "127.0.0.1", port = "0"] = (value || fallback).split(":");
  return { host, port: Number(port) };
};

/**
 * Firebase web config from `VITE_FIREBASE_*`. Without a project id the app runs against the
 * emulators under `demo-hellovalley`, which needs no real keys. A real project uses the real
 * services unless `VITE_FIREBASE_EMULATORS=true`.
 * TODO(M38): production values come from the Hosting build environment.
 */
export function readFirebaseConfig(env: Env): ClientFirebaseConfig {
  const projectId = env.VITE_FIREBASE_PROJECT_ID || DEMO_PROJECT_ID;
  const isDemo = projectId.startsWith("demo-");
  const options: FirebaseOptions = {
    // The emulators accept any API key; a demo project has none.
    apiKey: env.VITE_FIREBASE_API_KEY || (isDemo ? "demo-api-key" : undefined),
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    appId: env.VITE_FIREBASE_APP_ID || undefined,
  };
  const useEmulators = isDemo || env.VITE_FIREBASE_EMULATORS === "true";
  const auth = hostPort(env.VITE_FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  return {
    options,
    emulators: useEmulators
      ? {
          auth: `http://${auth.host}:${auth.port}`,
          firestore: hostPort(env.VITE_FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080"),
          storage: hostPort(env.VITE_FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:9199"),
        }
      : null,
  };
}
