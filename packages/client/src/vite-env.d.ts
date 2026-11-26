/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server base URL, e.g. https://hellovalley-server.fly.dev. Defaults to the local dev server. */
  readonly VITE_SERVER_URL?: string;
  /** Firebase project. Unset (or `demo-*`) runs against the local emulators. */
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** `true` to use the emulators with a real project id. */
  readonly VITE_FIREBASE_EMULATORS?: string;
  /** Emulator `host:port` overrides (defaults match firebase.json). */
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string;
  readonly VITE_FIRESTORE_EMULATOR_HOST?: string;
  readonly VITE_FIREBASE_STORAGE_EMULATOR_HOST?: string;
  /** Build plan M36: the reCAPTCHA Enterprise site key for App Check (unset: App Check is off). */
  readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
  /** Development only: an App Check debug token registered in the Firebase console (never commit it). */
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
}
