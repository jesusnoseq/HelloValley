import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { setAppCheckTokenSource } from "../net/appCheckToken";
import { appCheckTokenSource, readAppCheckConfig, startAppCheck } from "./appCheck";
import { readFirebaseConfig } from "./config";

/**
 * The one Firebase app for the client, pointed at the emulators in local dev (architecture §3.3).
 * Firestore and Storage live in `./firestore` and `./storage` so they stay out of the initial
 * bundle until a screen needs them (GDD §9.5 download budget).
 * Firebase AI Logic is set up lazily by `ai/firebaseModel.ts` (its own chunk); App Check (build
 * plan M36, reCAPTCHA Enterprise) starts here, before any AI Logic, Firestore or server call.
 */
export const firebaseConfig = readFirebaseConfig(import.meta.env);
export const firebaseApp = initializeApp(firebaseConfig.options);
export const appCheck = startAppCheck(firebaseApp, readAppCheckConfig(import.meta.env, firebaseConfig.options));
setAppCheckTokenSource(appCheckTokenSource(appCheck));
export const auth = getAuth(firebaseApp);

if (firebaseConfig.emulators) {
  connectAuthEmulator(auth, firebaseConfig.emulators.auth, { disableWarnings: true });
}
