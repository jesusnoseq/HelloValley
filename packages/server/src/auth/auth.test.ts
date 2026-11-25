import { describe, expect, it } from "vitest";
import { DEFAULT_AUTH_EMULATOR_HOST, readFirebaseConfig } from "../config";
import { createFirebaseVerifier, InvalidIdTokenError } from "./idToken";

const PROJECT = "demo-hellovalley";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** An unsigned ID token shaped like the ones the Auth emulator issues (claims are checked offline). */
function emulatorIdToken(uid: string, claims: Record<string, unknown> = {}, project = PROJECT): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://securetoken.google.com/${project}`,
    aud: project,
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    firebase: { sign_in_provider: "google.com", identities: {} },
    ...claims,
  };
  return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
}

const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST || DEFAULT_AUTH_EMULATOR_HOST;
const authEmulatorUp = await fetch(`http://${AUTH_EMULATOR}/`, { signal: AbortSignal.timeout(1500) }).then(
  () => true,
  () => false,
);

describe("createFirebaseVerifier (firebase-admin, emulator mode)", () => {
  const verifier = createFirebaseVerifier({ projectId: PROJECT, authEmulatorHost: AUTH_EMULATOR });

  // In emulator mode firebase-admin also looks the user up in the emulator, so this needs one running.
  it.skipIf(!authEmulatorUp)("returns the uid of a token issued by the Auth emulator", async () => {
    const res = await fetch(
      `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) },
    );
    const { idToken, localId } = (await res.json()) as { idToken: string; localId: string };
    await expect(verifier.verify(idToken)).resolves.toEqual({ uid: localId, admin: false });
  });

  it("rejects garbage, expired tokens and tokens for another project", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const rejected = [
      "garbage",
      emulatorIdToken("alice", { iat: past, auth_time: past, exp: past + 60 }),
      emulatorIdToken("alice", {}, "demo-other"),
      emulatorIdToken(""),
    ];
    for (const token of rejected) {
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(InvalidIdTokenError);
    }
  });
});

describe("readFirebaseConfig", () => {
  it("defaults to the demo project on the Auth emulator", () => {
    expect(readFirebaseConfig({})).toEqual({ projectId: PROJECT, authEmulatorHost: "127.0.0.1:9099" });
    expect(readFirebaseConfig({ FIREBASE_AUTH_EMULATOR_HOST: "localhost:9199" }).authEmulatorHost).toBe("localhost:9199");
  });

  it("uses real Auth for a real project", () => {
    expect(readFirebaseConfig({ FIREBASE_PROJECT_ID: "hellovalley-prod" })).toEqual({
      projectId: "hellovalley-prod",
      authEmulatorHost: null,
    });
  });

  it("refuses the emulator (unsigned tokens) for a real project", () => {
    expect(() =>
      readFirebaseConfig({ FIREBASE_PROJECT_ID: "hellovalley-prod", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }),
    ).toThrow(/real project/);
  });

  it("rejects invalid project ids", () => {
    expect(() => readFirebaseConfig({ FIREBASE_PROJECT_ID: "Bad/Project" })).toThrow(/FIREBASE_PROJECT_ID/);
  });
});
