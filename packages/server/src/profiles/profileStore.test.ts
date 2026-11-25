import { AvatarAppearanceSchema, buildOnboardingRecords, OnboardingRequestSchema } from "@hellovalley/shared";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_EMULATOR_HOST, DEMO_PROJECT_ID } from "../config";
import { adminApp } from "../firebase/admin";
import { createFirestoreProfileStore, createMemoryProfileStore, type ProfileStore } from "./profileStore";

const ts = { seconds: 1_790_000_000, nanoseconds: 0 };
const request = OnboardingRequestSchema.parse({
  name: "Kenji",
  nativeLang: "ja",
  targetLang: "es",
  selfAssessment: "brand_new",
  animal: "capybara",
  colors: { fur: "tawny", shirt: { swatch: "butter" }, trousers: { swatch: "moss" } },
  style: "mediterranean",
});
const records = (apartmentId: "6D" | "2B") => buildOnboardingRecords(request, { apartmentId, now: ts });

/** The same contract for every store implementation. */
function contract(name: string, make: () => ProfileStore, { skip = false } = {}) {
  describe.skipIf(skip)(`${name} profile store`, () => {
    it("has no profile before onboarding, then the created one", async () => {
      const store = make();
      const uid = `u${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      expect(await store.getProfile(uid)).toBeNull();
      const first = await store.createProfile(uid, records("6D"));
      expect(first.created).toBe(true);
      const stored = await store.getProfile(uid);
      expect(stored).toMatchObject({ name: "Kenji", apartmentId: "6D", targetLangs: ["es"] });
      expect(stored?.createdAt.seconds).toBe(ts.seconds);
    });

    it("never overwrites an existing profile", async () => {
      const store = make();
      const uid = `v${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      await store.createProfile(uid, records("6D"));
      const second = await store.createProfile(uid, records("2B"));
      expect(second.created).toBe(false);
      expect(second.profile.apartmentId).toBe("6D");
      expect((await store.getProfile(uid))?.apartmentId).toBe("6D");
    });

    it("updates only the appearance of an existing profile", async () => {
      const store = make();
      const uid = `a${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      const look = AvatarAppearanceSchema.parse({ animal: "fox", colors: { fur: "arctic", shirt: { h: 10, s: 0.5, l: 0.7 }, trousers: { swatch: "navy" } } });
      expect(await store.updateAppearance(uid, look)).toBeNull();
      expect(await store.getProfile(uid)).toBeNull();
      await store.createProfile(uid, records("6D"));
      const updated = await store.updateAppearance(uid, look);
      expect(updated).toMatchObject({ name: "Kenji", apartmentId: "6D", animal: "fox", colors: look.colors, style: "mediterranean" });
      const stored = await store.getProfile(uid);
      expect(stored).toMatchObject({ animal: "fox", colors: look.colors, targetLangs: ["es"] });
      expect(stored?.createdAt.seconds).toBe(ts.seconds);
    });
  });
}

contract("memory", () => createMemoryProfileStore());

// The Firestore store runs against the emulator only (`npm run emulators`); it skips without one.
const host = process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_FIRESTORE_EMULATOR_HOST;
const emulatorUp = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(1500) }).then(
  () => true,
  () => false,
);
if (process.env.FIRESTORE_EMULATOR_HOST && !emulatorUp) {
  throw new Error(`FIRESTORE_EMULATOR_HOST=${host} is set but unreachable`);
}
contract(
  "Firestore (emulator)",
  () =>
    createFirestoreProfileStore(
      getFirestore(adminApp({ projectId: DEMO_PROJECT_ID, authEmulatorHost: null, firestoreEmulatorHost: host })),
    ),
  { skip: !emulatorUp },
);

describe.skipIf(!emulatorUp)("Firestore profile store (emulator) documents", () => {
  it("writes users/{uid} and users/{uid}/langs/{lang}", async () => {
    const db = getFirestore(adminApp({ projectId: DEMO_PROJECT_ID, authEmulatorHost: null, firestoreEmulatorHost: host }));
    const uid = `w${Date.now()}`;
    await createFirestoreProfileStore(db).createProfile(uid, records("6D"));
    const lang = await db.doc(`users/${uid}/langs/es`).get();
    expect(lang.data()).toMatchObject({ level: "A1", coins: 50 });
  });
});
