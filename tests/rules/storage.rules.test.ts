import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { type FirebaseStorage, getMetadata, ref, uploadBytes } from "firebase/storage";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { findEmulator, PROJECT_ID, readRules } from "./emulator";

const emulator = await findEmulator("FIREBASE_STORAGE_EMULATOR_HOST", "127.0.0.1:9199");

const CLIP = `tts/${"a".repeat(64)}.ogg`;
const audio = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
const ogg = { contentType: "audio/ogg" };

describe.skipIf(!emulator.available)("storage.rules", () => {
  let env: RulesTestEnvironment;
  const storage = (ctx: { storage(): unknown }) => ctx.storage() as FirebaseStorage;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: { host: emulator.host, port: emulator.port, rules: readRules("storage.rules") },
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  beforeEach(async () => {
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(storage(ctx), CLIP), audio, ogg);
    });
  });

  it("seeded clips are readable by signed-in users only", async () => {
    await assertSucceeds(getMetadata(ref(storage(env.authenticatedContext("bob")), CLIP)));
    await assertFails(getMetadata(ref(storage(env.unauthenticatedContext()), CLIP)));
  });

  it("only the admin claim can upload clips, with a hash name and audio type", async () => {
    const admin = storage(env.authenticatedContext("seeder", { admin: true }));
    const bob = storage(env.authenticatedContext("bob"));
    const name = `tts/${"b".repeat(64)}.ogg`;
    await assertFails(uploadBytes(ref(bob, name), audio, ogg));
    await assertFails(uploadBytes(ref(admin, "tts/not-a-hash.ogg"), audio, ogg));
    await assertFails(uploadBytes(ref(admin, name), audio, { contentType: "text/html" }));
    await assertSucceeds(uploadBytes(ref(admin, name), audio, ogg));
  });

  it("denies every other path", async () => {
    const admin = storage(env.authenticatedContext("seeder", { admin: true }));
    await assertFails(uploadBytes(ref(admin, "kits/europe.glb"), audio));
    await assertFails(getMetadata(ref(storage(env.authenticatedContext("bob")), "kits/europe.glb")));
  });
});
