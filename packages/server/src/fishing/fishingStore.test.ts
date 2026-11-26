import { FirestorePaths, type SlotEntry } from "@hellovalley/shared";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_EMULATOR_HOST, DEMO_PROJECT_ID } from "../config";
import { adminApp } from "../firebase/admin";
import { createMemoryNpcStore } from "../npc/npcStore";
import { createFirestoreFishingStore, createMemoryFishingStore, type FishingStore } from "./fishingStore";

/**
 * Build plan M27: the fishing store contract (rod and Elder hearts for a cast, catches into the
 * bag and the encyclopedia in one go). Every implementation runs the same cases; the Firestore one
 * needs the emulator and skips without it.
 */

interface Harness {
  store: FishingStore;
  seed(uid: string, lang: string, slots: SlotEntry[], elderHearts: number): Promise<void>;
}

function contract(name: string, make: () => Harness, { skip = false } = {}) {
  describe.skipIf(skip)(`${name} store: fishing`, () => {
    const uid = () => `f${Date.now()}${Math.floor(Math.random() * 1e6)}`;

    it("reads the cast context, or null without langs/{lang}", async () => {
      const { store, seed } = make();
      const u = uid();
      expect(await store.context(u, "es")).toBeNull();
      expect(await store.recordCatch(u, "es", "carp", 1000)).toBeNull();
      await seed(u, "es", [{ slot: 24, itemId: "fishing_rod", qty: 1 }], 5);
      expect(await store.context(u, "es")).toEqual({ slots: [{ slot: 24, itemId: "fishing_rod", qty: 1 }], elderHearts: 5 });
      expect(await store.log(u)).toEqual({});
    });

    it("lands catches in the bag and the encyclopedia, and releases them when the bag is full", async () => {
      const { store, seed } = make();
      const u = uid();
      await seed(u, "es", [{ slot: 24, itemId: "fishing_rod", qty: 1 }], 0);
      expect(await store.recordCatch(u, "es", "carp", 1000)).toMatchObject({ kept: true, first: true, entry: { count: 1, firstMs: 1000, lastMs: 1000 } });
      const again = await store.recordCatch(u, "es", "carp", 2000);
      expect(again).toMatchObject({ kept: true, first: false, entry: { count: 2, firstMs: 1000, lastMs: 2000 } });
      expect(again!.slots).toEqual([
        { slot: 0, itemId: "carp", qty: 2 },
        { slot: 24, itemId: "fishing_rod", qty: 1 },
      ]);
      expect(await store.log(u)).toEqual({ carp: { count: 2, firstMs: 1000, lastMs: 2000 } });

      const v = uid();
      await seed(v, "es", Array.from({ length: 30 }, (_, slot) => ({ slot, itemId: "bread" as const, qty: 99 })), 0);
      expect(await store.recordCatch(v, "es", "eel", 3000)).toMatchObject({ kept: false, first: true });
      expect(await store.log(v)).toEqual({ eel: { count: 1, firstMs: 3000, lastMs: 3000 } });
      expect((await store.context(v, "es"))!.slots.some((s) => s.itemId === "eel")).toBe(false);
    });
  });
}

contract("memory", () => {
  const npc = createMemoryNpcStore();
  return {
    store: createMemoryFishingStore(npc),
    seed: async (uid, lang, slots, elderHearts) => {
      npc.players.set(`${uid}/${lang}`, { level: "A2", coins: 0, hearts: { elder: elderHearts }, slots });
    },
  };
});

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
  () => {
    const db = getFirestore(adminApp({ projectId: DEMO_PROJECT_ID, authEmulatorHost: null, firestoreEmulatorHost: host }));
    return {
      store: createFirestoreFishingStore(db),
      seed: async (uid, lang, slots, elderHearts) => {
        await db.doc(FirestorePaths.lang(uid, lang)).set({ level: "A2", levelEstimate: 2, streak: 0, coins: 0, hearts: { elder: elderHearts }, settings: {} });
        await Promise.all(slots.map((s) => db.doc(FirestorePaths.inventorySlot(uid, String(s.slot))).set({ itemId: s.itemId, qty: s.qty })));
      },
    };
  },
  { skip: !emulatorUp },
);
