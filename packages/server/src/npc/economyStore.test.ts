import { FirestorePaths, type SlotEntry } from "@hellovalley/shared";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_EMULATOR_HOST, DEMO_PROJECT_ID } from "../config";
import { adminApp } from "../firebase/admin";
import { createFirestoreNpcStore, createMemoryNpcStore, type NpcStore } from "./npcStore";

/**
 * Build plan M26: the store contract for coins and inventory (architecture §6.2): the wallet,
 * trades that never take coins below 0 or sell what is not held, and slot moves that only
 * rearrange. Every implementation runs the same cases; the Firestore one needs the emulator.
 */

interface Harness {
  store: NpcStore;
  /** Creates `users/{uid}/langs/{lang}` with these coins and slots. */
  seed(uid: string, lang: string, coins: number, slots: SlotEntry[]): Promise<void>;
}

function contract(name: string, make: () => Harness, { skip = false } = {}) {
  describe.skipIf(skip)(`${name} store: coins and inventory`, () => {
    const uid = () => `e${Date.now()}${Math.floor(Math.random() * 1e6)}`;

    it("reads the wallet, or null without langs/{lang}", async () => {
      const { store, seed } = make();
      const u = uid();
      expect(await store.wallet(u, "es")).toBeNull();
      expect(await store.moveSlot(u, "es", 0, 1)).toBeNull();
      await seed(u, "es", 12, [{ slot: 3, itemId: "bread", qty: 2 }]);
      expect(await store.wallet(u, "es")).toEqual({ coins: 12, slots: [{ slot: 3, itemId: "bread", qty: 2 }] });
    });

    it("settles a purchase and a sale, and refuses negative coins and items not held", async () => {
      const { store, seed } = make();
      const u = uid();
      await seed(u, "es", 10, [{ slot: 0, itemId: "daisy", qty: 3 }]);
      expect(await store.apply(u, "es", { npcId: "baker", coins: -11, hearts: 0, items: [{ itemId: "bread", qty: 2 }] })).toEqual({ ok: false, reason: "insufficient_coins" });
      const bought = await store.apply(u, "es", { npcId: "baker", coins: -10, hearts: 0, items: [{ itemId: "bread", qty: 2 }] });
      expect(bought).toMatchObject({ ok: true, coins: 0, slots: [{ slot: 0, itemId: "daisy", qty: 3 }, { slot: 1, itemId: "bread", qty: 2 }] });
      expect(await store.apply(u, "es", { npcId: "farmer", coins: 8, hearts: 0, items: [{ itemId: "daisy", qty: -4 }] })).toEqual({ ok: false, reason: "not_owned" });
      expect(await store.apply(u, "es", { npcId: "farmer", coins: 6, hearts: 0, items: [{ itemId: "daisy", qty: -3 }] })).toMatchObject({ ok: true, coins: 6 });
      expect(await store.wallet(u, "es")).toEqual({ coins: 6, slots: [{ slot: 1, itemId: "bread", qty: 2 }] });
    });

    it("moves, swaps and refuses moves from empty slots", async () => {
      const { store, seed } = make();
      const u = uid();
      await seed(u, "es", 1, [
        { slot: 0, itemId: "bread", qty: 2 },
        { slot: 1, itemId: "tea", qty: 1 },
      ]);
      expect(await store.moveSlot(u, "es", 0, 24)).toEqual({ ok: true, coins: 1, slots: [{ slot: 1, itemId: "tea", qty: 1 }, { slot: 24, itemId: "bread", qty: 2 }] });
      expect(await store.moveSlot(u, "es", 1, 24)).toMatchObject({ ok: true, slots: [{ slot: 1, itemId: "bread", qty: 2 }, { slot: 24, itemId: "tea", qty: 1 }] });
      expect(await store.moveSlot(u, "es", 5, 6)).toMatchObject({ ok: false, reason: "empty_slot", slots: [{ slot: 1, itemId: "bread", qty: 2 }, { slot: 24, itemId: "tea", qty: 1 }] });
      expect(await store.wallet(u, "es")).toEqual({ coins: 1, slots: [{ slot: 1, itemId: "bread", qty: 2 }, { slot: 24, itemId: "tea", qty: 1 }] });
    });
  });
}

contract("memory", () => {
  const store = createMemoryNpcStore();
  return {
    store,
    seed: async (uid, lang, coins, slots) => {
      store.players.set(`${uid}/${lang}`, { level: "A2", coins, hearts: {}, slots });
    },
  };
});

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
  () => {
    const db = getFirestore(adminApp({ projectId: DEMO_PROJECT_ID, authEmulatorHost: null, firestoreEmulatorHost: host }));
    return {
      store: createFirestoreNpcStore(db),
      seed: async (uid, lang, coins, slots) => {
        await db.doc(FirestorePaths.lang(uid, lang)).set({ level: "A2", levelEstimate: 2, streak: 0, coins, hearts: {}, settings: {} });
        await Promise.all(slots.map((s) => db.doc(FirestorePaths.inventorySlot(uid, String(s.slot))).set({ itemId: s.itemId, qty: s.qty })));
      },
    };
  },
  { skip: !emulatorUp },
);
