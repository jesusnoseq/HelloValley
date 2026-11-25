import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { readFirebaseConfig } from "./config";

/**
 * The one Firebase app for the client, pointed at the emulators in local dev (architecture §3.3).
 * Firestore and Storage live in `./firestore` and `./storage` so they stay out of the initial
 * bundle until a screen needs them (GDD §9.5 download budget).
 * Firebase AI Logic is set up lazily by `ai/firebaseModel.ts` (its own chunk).
 * TODO(M36): App Check (reCAPTCHA Enterprise).
 */
export const firebaseConfig = readFirebaseConfig(import.meta.env);
export const firebaseApp = initializeApp(firebaseConfig.options);
export const auth = getAuth(firebaseApp);

if (firebaseConfig.emulators) {
  connectAuthEmulator(auth, firebaseConfig.emulators.auth, { disableWarnings: true });
}
