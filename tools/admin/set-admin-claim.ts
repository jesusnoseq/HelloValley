/**
 * Sets or removes the `admin: true` custom claim (build plan M38, architecture §6.3). Only an
 * account with this claim may write the shared `cache/*` and Storage `tts/` (the seeding tools)
 * or read `GET /api/metrics`. Existing claims are kept; only `admin` changes. The user must sign
 * out and in again (or refresh their ID token) before the claim shows up.
 *
 *   npm run admin:claim -- <uid|email>                                 dry run: print the plan
 *   npm run admin:claim -- <uid|email> --write --project <id>          grant (admin credentials)
 *   npm run admin:claim -- <uid|email> --revoke --write --project <id> remove the claim
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS (a service account allowed to manage users), or
 * the Auth emulator (FIREBASE_AUTH_EMULATOR_HOST) with a demo-* project.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface ClaimPlan {
  /** A uid, or an e-mail to look up. */
  user: { uid: string } | { email: string };
  admin: boolean;
}

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function planClaim(args: readonly string[]): ClaimPlan | string {
  const target = args[0];
  if (!target || target.startsWith("--")) return "usage: set-admin-claim <uid|email> [--revoke] [--write --project <id>]";
  const user = EMAIL.test(target) ? { email: target } : UID.test(target) ? { uid: target } : null;
  if (!user) return `not a uid or an e-mail: ${target}`;
  return { user, admin: !args.includes("--revoke") };
}

/** The new custom claims: the old ones with `admin` set, or removed on revoke. */
export function nextClaims(current: Record<string, unknown> | undefined, admin: boolean): Record<string, unknown> {
  const { admin: _old, ...rest } = current ?? {};
  return admin ? { ...rest, admin: true } : rest;
}

function arg(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(args: readonly string[]): Promise<number> {
  const plan = planClaim(args);
  if (typeof plan === "string") {
    console.error(plan);
    return 2;
  }
  const who = "uid" in plan.user ? `uid ${plan.user.uid}` : `e-mail ${plan.user.email}`;
  console.log(`${plan.admin ? "grant" : "revoke"} admin: ${who}`);
  if (!args.includes("--write")) {
    console.log("dry run: nothing written (add --write --project <id>)");
    return 0;
  }
  const projectId = arg(args, "--project");
  if (!projectId) {
    console.error("--write needs --project <id>");
    return 2;
  }
  const emulated = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  if (emulated && !projectId.startsWith("demo-")) {
    console.error("FIREBASE_AUTH_EMULATOR_HOST is set for a real project; use a demo-* project with the emulators");
    return 2;
  }
  if (!emulated && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("--write needs GOOGLE_APPLICATION_CREDENTIALS (an admin service account) or the Auth emulator");
    return 2;
  }
  const { applicationDefault, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const app = initializeApp(emulated ? { projectId } : { projectId, credential: applicationDefault() }, "hellovalley-admin-claim");
  const auth = getAuth(app);
  const record = "uid" in plan.user ? await auth.getUser(plan.user.uid) : await auth.getUserByEmail(plan.user.email);
  await auth.setCustomUserClaims(record.uid, nextClaims(record.customClaims, plan.admin));
  console.log(`done: ${record.uid} admin=${plan.admin} (sign out and in again to refresh the token)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
