import { applyFurnitureEdit, defaultApartmentLayout, FirestorePaths } from "@hellovalley/shared";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_EMULATOR_HOST, DEMO_PROJECT_ID } from "../config";
import { adminApp } from "../firebase/admin";
import { type ApartmentLayoutStore, CorruptLayoutError, createFirestoreLayoutStore, createMemoryLayoutStore } from "./layoutStore";

const edited = (() => {
  const r = applyFurnitureEdit(defaultApartmentLayout(), { op: "store", index: 10, itemId: "wooden_chair" });
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
})();

/** The same contract for every store implementation. */
function contract(name: string, make: () => ApartmentLayoutStore, { skip = false } = {}) {
  describe.skipIf(skip)(`${name} layout store`, () => {
    it("has no layout until one is saved, then returns it", async () => {
      const store = make();
      const uid = `l${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      expect(await store.getLayout(uid)).toBeNull();
      await store.saveLayout(uid, edited);
      expect(await store.getLayout(uid)).toEqual(edited);
      await store.saveLayout(uid, defaultApartmentLayout());
      expect(await store.getLayout(uid)).toEqual(defaultApartmentLayout());
    });

    it("refuses to save a malformed layout", async () => {
      const store = make();
      const bad = { furniture: [{ itemId: "throne", x: 0, z: 0, rot: 0 }], stored: [] } as never;
      await expect(store.saveLayout("someone", bad)).rejects.toThrow();
    });
  });
}

contract("memory", () => createMemoryLayoutStore());

// The Firestore store runs against the emulator only (`npm run emulators`); it skips without one.
const host = process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_FIRESTORE_EMULATOR_HOST;
const emulatorUp = await fetch(`http://${host}/`, { signal: AbortSignal.timeout(1500) }).then(
  () => true,
  () => false,
);
if (process.env.FIRESTORE_EMULATOR_HOST && !emulatorUp) {
  throw new Error(`FIRESTORE_EMULATOR_HOST=${host} is set but unreachable`);
}
const emulatorDb = () => getFirestore(adminApp({ projectId: DEMO_PROJECT_ID, authEmulatorHost: null, firestoreEmulatorHost: host }));
contract("Firestore (emulator)", () => createFirestoreLayoutStore(emulatorDb()), { skip: !emulatorUp });

describe.skipIf(!emulatorUp)("Firestore layout store (emulator) documents", () => {
  it("writes users/{uid}/apartment/layout and rejects a corrupt document on read", async () => {
    const db = emulatorDb();
    const uid = `c${Date.now()}`;
    await createFirestoreLayoutStore(db).saveLayout(uid, edited);
    expect((await db.doc(`users/${uid}/apartment/layout`).get()).data()).toMatchObject({ stored: ["wooden_chair"] });
    await db.doc(FirestorePaths.apartmentLayout(uid)).set({ furniture: "nope" });
    await expect(createFirestoreLayoutStore(db).getLayout(uid)).rejects.toBeInstanceOf(CorruptLayoutError);
  });
});
