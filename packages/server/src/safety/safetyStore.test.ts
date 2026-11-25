import type { ChatReportInput } from "@hellovalley/shared";
import { getFirestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { DEFAULT_FIRESTORE_EMULATOR_HOST, DEMO_PROJECT_ID } from "../config";
import { adminApp } from "../firebase/admin";
import { createFirestoreSafetyStore, createMemorySafetyStore, type SafetyStore } from "./safetyStore";

const report: ChatReportInput = {
  kind: "chat",
  reporterUid: "bob",
  reportedUid: "alice",
  reportedName: "Alice",
  reason: "spam",
  messageId: "m1",
  shard: 1,
  messages: [{ id: "m1", text: "buy coins", lang: "en", ts: 1_790_000_000_000 }],
};

/** The same contract for every store implementation. */
function contract(name: string, make: () => SafetyStore, { skip = false } = {}) {
  describe.skipIf(skip)(`${name} safety store`, () => {
    it("has no blocks until saved, then returns them", async () => {
      const store = make();
      const uid = `s${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      expect(await store.getBlocks(uid)).toEqual([]);
      await store.saveBlocks(uid, [{ uid: "alice", name: "Alice" }]);
      expect(await store.getBlocks(uid)).toEqual([{ uid: "alice", name: "Alice" }]);
      await store.saveBlocks(uid, []);
      expect(await store.getBlocks(uid)).toEqual([]);
    });

    it("files valid reports and refuses malformed ones", async () => {
      const store = make();
      expect(await store.addReport(report)).toMatch(/.+/);
      await expect(store.addReport({ ...report, reason: "boring" } as never)).rejects.toThrow();
      await expect(store.saveBlocks("u", [{ uid: "a/b", name: "X" }])).rejects.toThrow();
    });
  });
}

contract("memory", () => createMemorySafetyStore());

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
contract("Firestore (emulator)", () => createFirestoreSafetyStore(emulatorDb()), { skip: !emulatorUp });

describe.skipIf(!emulatorUp)("Firestore safety store (emulator) documents", () => {
  it("writes users/{uid}/safety/blocks and reports/{id} with a server timestamp", async () => {
    const db = emulatorDb();
    const store = createFirestoreSafetyStore(db);
    const uid = `b${Date.now()}`;
    await store.saveBlocks(uid, [{ uid: "alice", name: "Alice" }]);
    expect((await db.doc(`users/${uid}/safety/blocks`).get()).data()).toEqual({ players: [{ uid: "alice", name: "Alice" }] });
    const id = await store.addReport(report);
    const doc = (await db.doc(`reports/${id}`).get()).data();
    expect(doc).toMatchObject({ reporterUid: "bob", reportedUid: "alice", reason: "spam" });
    expect(doc?.createdAt).toBeDefined();
    // A corrupt block list reads as empty rather than locking the player out.
    await db.doc(`users/${uid}/safety/blocks`).set({ players: "nope" });
    expect(await store.getBlocks(uid)).toEqual([]);
  });
});
