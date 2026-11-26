import { FirestorePaths, type SlotEntry } from "@hellovalley/shared";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_EMULATOR_HOST, DEMO_PROJECT_ID } from "../config";
import { adminApp } from "../firebase/admin";
import { createMemoryNpcStore } from "../npc/npcStore";
import { createFirestoreFoodStore, createMemoryFoodStore, type FoodStore } from "./foodStore";

/**
 * Build plan M29: the food store contract (the recipe book, cooking and eating in one transaction
 * each). Every implementation runs the same cases; the Firestore one needs the emulator and skips
 * without it.
 */

interface Harness {
  store: FoodStore;
  seed(uid: string, lang: string, slots: SlotEntry[]): Promise<void>;
}

function contract(name: string, make: () => Harness, { skip = false } = {}) {
  describe.skipIf(skip)(`${name} store: food`, () => {
    const uid = () => `e${Date.now()}${Math.floor(Math.random() * 1e6)}`;

    it("keeps taught recipes once, with who taught them", async () => {
      const { store } = make();
      const u = uid();
      expect(await store.book(u)).toEqual({ known: {} });
      expect((await store.learn(u, ["bread", "nonsense"], "baker", "es", 1000)).learned).toEqual(["bread"]);
      expect((await store.learn(u, ["bread"], "baker", "ja", 2000)).learned).toEqual([]);
      expect(await store.book(u)).toEqual({ known: { bread: { teacher: "baker", lang: "es", learnedMs: 1000, cooked: 0 } } });
    });

    it("cooks a known recipe from the ingredients held, all or nothing", async () => {
      const { store, seed } = make();
      const u = uid();
      await seed(u, "es", [
        { slot: 0, itemId: "flour", qty: 3 },
        { slot: 1, itemId: "milk", qty: 1 },
      ]);
      expect(await store.cook(u, "es", "bread")).toEqual({ ok: false, reason: "not_known" });
      await store.learn(u, ["bread"], "baker", "es", 1000);
      const dish = await store.cook(u, "es", "bread");
      expect(dish).toMatchObject({ ok: true, result: "bread", slots: [{ slot: 0, itemId: "flour", qty: 1 }, { slot: 1, itemId: "bread", qty: 1 }] });
      expect((await store.book(u)).known.bread?.cooked).toBe(1);
      expect(await store.cook(u, "es", "bread")).toMatchObject({ ok: false, reason: "missing_ingredients" });
    });

    it("eats one from a hotbar slot", async () => {
      const { store, seed } = make();
      const u = uid();
      await seed(u, "es", [
        { slot: 3, itemId: "bread", qty: 1 },
        { slot: 24, itemId: "bread", qty: 2 },
        { slot: 25, itemId: "fishing_rod", qty: 1 },
      ]);
      expect(await store.eat(u, "es", 3)).toEqual({ ok: false, reason: "not_hotbar" });
      expect(await store.eat(u, "es", 25)).toEqual({ ok: false, reason: "not_food" });
      expect(await store.eat(u, "es", 26)).toEqual({ ok: false, reason: "empty_slot" });
      expect(await store.eat(u, "es", 24)).toMatchObject({ ok: true, itemId: "bread" });
      expect(await store.eat(u, "es", 24)).toMatchObject({ ok: true, itemId: "bread" });
      expect(await store.eat(u, "es", 24)).toEqual({ ok: false, reason: "empty_slot" });
    });
  });
}

contract("memory", () => {
  const npc = createMemoryNpcStore();
  return {
    store: createMemoryFoodStore(npc),
    seed: async (uid, lang, slots) => {
      npc.players.set(`${uid}/${lang}`, { level: "A2", coins: 0, hearts: {}, slots });
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
      store: createFirestoreFoodStore(db),
      seed: async (uid, lang, slots) => {
        await db.doc(FirestorePaths.lang(uid, lang)).set({ level: "A2", levelEstimate: 2, streak: 0, coins: 0, hearts: {}, settings: {} });
        await Promise.all(slots.map((s) => db.doc(FirestorePaths.inventorySlot(uid, String(s.slot))).set({ itemId: s.itemId, qty: s.qty })));
      },
    };
  },
  { skip: !emulatorUp },
);
