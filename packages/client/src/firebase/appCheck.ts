import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import { type AppCheck, getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

/**
 * Firebase App Check for the web client (build plan M36, architecture §9: "only the real web app
 * can call the models"). The reCAPTCHA Enterprise provider attests the page; AI Logic, Firestore
 * and Storage attach the token by themselves once App Check is initialized (it must happen before
 * `getAI`), and the game server gets it on every `/api/*` call and room join
 * (`net/appCheckToken.ts`).
 *
 * Configuration comes from the build environment, never from the repository:
 * - `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`: the reCAPTCHA Enterprise site key registered for the
 *   web app in the Firebase console (a site key is public, but it is per project, so it stays in
 *   `.env.local` in development and `.env.production.local` for the Hosting build, docs/deploy.md).
 * - `VITE_APPCHECK_DEBUG_TOKEN` (development only): a debug token registered in the console, so
 *   `localhost` works without adding it to the reCAPTCHA domains. Without it, a dev build asks the
 *   SDK to print a new debug token in the console (register it, then put it in `.env.local`).
 *
 * The `demo-*` emulator project has no App Check (there is no emulator for it): nothing starts.
 */

export interface AppCheckConfig {
  siteKey: string;
  /** The debug token (a registered one, or `true` to print a new one); null in production builds. */
  debugToken: string | true | null;
}

type Env = { VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string | undefined; VITE_APPCHECK_DEBUG_TOKEN?: string | undefined; DEV?: boolean | undefined };

export function readAppCheckConfig(env: Env, options: Pick<FirebaseOptions, "projectId">): AppCheckConfig | null {
  if (!options.projectId || options.projectId.startsWith("demo-")) return null;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim();
  if (!siteKey) {
    if (!env.DEV) console.warn("[app-check] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY is not set: App Check is off, and an enforcing server will refuse this client");
    return null;
  }
  const debug = env.VITE_APPCHECK_DEBUG_TOKEN?.trim();
  return { siteKey, debugToken: env.DEV ? debug || true : null };
}

declare global {
  // The App Check SDK reads this global before it initializes (debug provider).
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

/** Starts App Check with reCAPTCHA Enterprise (auto refresh on); null when not configured. */
export function startAppCheck(app: FirebaseApp, config: AppCheckConfig | null): AppCheck | null {
  if (!config) return null;
  if (config.debugToken !== null) globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = config.debugToken;
  return initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(config.siteKey), isTokenAutoRefreshEnabled: true });
}

/** A token for the game server (cached and refreshed by the SDK); null without App Check. */
export function appCheckTokenSource(appCheck: AppCheck | null): () => Promise<string | null> {
  return async () => (appCheck ? (await getToken(appCheck, false)).token : null);
}
