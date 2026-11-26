import { acceptQuest, baseQuestReward, FirestorePaths, getQuestTemplate, type Quest, type QuestClock, questIdFor, type SlotEntry } from "@hellovalley/shared";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_EMULATOR_HOST, DEMO_PROJECT_ID } from "../config";
import { adminApp } from "../firebase/admin";
import { createMemoryNpcStore } from "../npc/npcStore";
import { createFirestoreQuestStore, createMemoryQuestStore, type QuestStore } from "./questStore";

/**
 * Build plan M30: the quest store contract (the log per language, and a completion that pays the
 * coins and hearts and takes the hand-in in one transaction). Every implementation runs the same
 * cases; the Firestore one needs the emulator and skips without it.
 */

interface Harness {
  store: QuestStore;
  seed(uid: string, lang: string, slots: SlotEntry[], coins: number): Promise<void>;
  wallet(uid: string, lang: string): Promise<{ coins: number; hearts: Record<string, number> }>;
}

const DAY = 40;
const clock: QuestClock = { day: DAY, minutes: 8 * 60, nowMs: 1_000_000 };
const quest = (id: string): Quest => {
  const template = getQuestTemplate(id)!;
  return { questId: questIdFor(DAY, id), day: DAY, source: "board", template, reward: baseQuestReward(template) };
};

function contract(name: string, make: () => Harness, { skip = false } = {}) {
  describe.skipIf(skip)(`${name} store: quests`, () => {
    const uid = () => `q${Date.now()}${Math.floor(Math.random() * 1e6)}`;

    it("keeps one log per target language", async () => {
      const { store } = make();
      const u = uid();
      expect(await store.log(u, "es")).toBeNull();
      const q = quest("herbs_for_doctor");
      const ok = await store.update(u, "es", (log) => {
        const r = acceptQuest(log, q, null, clock);
        return { log: r.ok ? r.log : null, result: r.ok };
      });
      expect(ok).toBe(true);
      expect((await store.log(u, "es"))?.entries[q.questId]).toEqual({ status: "active", progress: 0, acceptedMs: clock.nowMs, via: "board" });
      expect(await store.log(u, "ja")).toBeNull();
      // A refused change writes nothing.
      expect(await store.update(u, "ja", () => ({ log: null, result: "nothing" }))).toBe("nothing");
      expect(await store.log(u, "ja")).toBeNull();
    });

    it("settles a hand-in once: coins, hearts with the requester, the items, the log", async () => {
      const { store, seed, wallet } = make();
      const u = uid();
      const q = quest("herbs_for_doctor");
      expect(await store.settle(u, "es", q, "doctor", clock)).toBeNull();
      await seed(u, "es", [{ slot: 0, itemId: "wild_herb", qty: 3 }], 5);
      await store.update(u, "es", (log) => {
        const r = acceptQuest(log, q, null, clock);
        return { log: r.ok ? r.log : null, result: null };
      });
      expect(await store.settle(u, "es", q, "baker", clock)).toEqual({ ok: false, reason: "wrong_npc" });
      const done = await store.settle(u, "es", q, "doctor", clock);
      expect(done).toMatchObject({ ok: true, coins: 5 + q.reward.coins, hearts: 1, slots: [{ slot: 0, itemId: "wild_herb", qty: 1 }] });
      expect(await wallet(u, "es")).toEqual({ coins: 5 + q.reward.coins, hearts: { doctor: 1 } });
      expect((await store.log(u, "es"))?.completed).toEqual({ fetch: 1 });
      expect(await store.settle(u, "es", q, "doctor", clock)).toEqual({ ok: false, reason: "not_active" });
    });
  });
}

contract("memory", () => {
  const npc = createMemoryNpcStore();
  return {
    store: createMemoryQuestStore(npc),
    seed: async (uid, lang, slots, coins) => {
      npc.players.set(`${uid}/${lang}`, { level: "A2", coins, hearts: {}, slots });
    },
    wallet: async (uid, lang) => {
      const p = npc.players.get(`${uid}/${lang}`)!;
      return { coins: p.coins, hearts: p.hearts as Record<string, number> };
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
      store: createFirestoreQuestStore(db),
      seed: async (uid, lang, slots, coins) => {
        await db.doc(FirestorePaths.lang(uid, lang)).set({ level: "A2", levelEstimate: 2, streak: 0, coins, hearts: {}, settings: {} });
        await Promise.all(slots.map((s) => db.doc(FirestorePaths.inventorySlot(uid, String(s.slot))).set({ itemId: s.itemId, qty: s.qty })));
      },
      wallet: async (uid, lang) => {
        const data = (await db.doc(FirestorePaths.lang(uid, lang)).get()).data() as { coins: number; hearts: Record<string, number> };
        return { coins: data.coins, hearts: data.hearts };
      },
    };
  },
  { skip: !emulatorUp },
);
