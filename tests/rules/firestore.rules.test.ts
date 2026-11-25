import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { FirestorePaths } from "@hellovalley/shared";
import {
  collection,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { findEmulator, PROJECT_ID, readRules } from "./emulator";

const emulator = await findEmulator("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");

const ALICE = "alice";
const BOB = "bob";
const P = FirestorePaths;

const profile = () => ({
  name: "Alice",
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "mint" }, trousers: { h: 200, s: 0.4, l: 0.7 } },
  apartmentId: "3B",
  nativeLang: "en",
  targetLangs: ["ja"],
  style: "japanese",
  createdAt: Timestamp.fromMillis(1_790_000_000_000),
});

const progress = () => ({
  level: "A1",
  levelEstimate: 0,
  streak: 0,
  coins: 50,
  hearts: { baker: 1 },
  settings: { scriptMode: "native" },
});

const entry = () => ({ surface: "パン", gloss: "bread", source: "npc:baker", createdAt: serverTimestamp() });

describe.skipIf(!emulator.available)("firestore.rules", () => {
  let env: RulesTestEnvironment;
  // The compat instance works with the modular API at runtime; only the types differ.
  const db = (ctx: RulesTestContext) => ctx.firestore() as unknown as Firestore;
  let alice: Firestore;
  let bob: Firestore;
  let anon: Firestore;
  let admin: Firestore;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host: emulator.host, port: emulator.port, rules: readRules("firestore.rules") },
    });
    alice = db(env.authenticatedContext(ALICE));
    bob = db(env.authenticatedContext(BOB));
    anon = db(env.unauthenticatedContext());
    admin = db(env.authenticatedContext("seeder", { admin: true }));
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  // Seed what the game server would have written (Admin SDK, rules bypassed).
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const s = db(ctx);
      await setDoc(doc(s, P.user(ALICE)), profile());
      await setDoc(doc(s, P.lang(ALICE, "ja")), progress());
      await setDoc(doc(s, P.notebookEntry(ALICE, "ja", "e1")), { ...entry(), createdAt: Timestamp.now() });
      await setDoc(doc(s, P.npcMemory(ALICE, "ja", "baker")), { summary: "likes rye", facts: [], lastSeen: Timestamp.now() });
      await setDoc(doc(s, P.inventorySlot(ALICE, "0")), { itemId: "bread", qty: 1 });
      await setDoc(doc(s, P.apartmentLayout(ALICE)), { furniture: [] });
      await setDoc(doc(s, P.villageEvent("shard-1", "ev1")), { type: "fish_caught", payload: {}, ts: Timestamp.now() });
      await setDoc(doc(s, P.cacheEntry("lines", "h1")), { text: "こんにちは" });
      await setDoc(doc(s, P.report("r1")), { reason: "spam" });
    });
  });

  describe("users/{uid} profile", () => {
    it("only the owner can read it", async () => {
      await assertSucceeds(getDoc(doc(alice, P.user(ALICE))));
      await assertFails(getDoc(doc(bob, P.user(ALICE))));
      await assertFails(getDoc(doc(anon, P.user(ALICE))));
      await assertFails(getDocs(collection(bob, "users")));
    });

    it("the owner can change appearance, style and native language", async () => {
      await assertSucceeds(updateDoc(doc(alice, P.user(ALICE)), { style: "european" }));
      await assertSucceeds(updateDoc(doc(alice, P.user(ALICE)), { animal: "cat", "colors.fur": "ginger" }));
      await assertSucceeds(updateDoc(doc(alice, P.user(ALICE)), { "colors.shirt": { h: 10, s: 0.5, l: 0.8 } }));
      await assertSucceeds(updateDoc(doc(alice, P.user(ALICE)), { nativeLang: "es" }));
    });

    it("server-owned fields cannot be changed by the owner", async () => {
      const ref = doc(alice, P.user(ALICE));
      await assertFails(updateDoc(ref, { apartmentId: "9H" }));
      await assertFails(updateDoc(ref, { createdAt: Timestamp.now() }));
      await assertFails(updateDoc(ref, { name: "Mallory" }));
      await assertFails(updateDoc(ref, { targetLangs: ["ja", "fr"] }));
    });

    it("economy fields and unknown keys cannot be added", async () => {
      const ref = doc(alice, P.user(ALICE));
      for (const field of ["coins", "inventory", "hearts", "npcMemory", "level", "admin"]) {
        await assertFails(updateDoc(ref, { [field]: 9999 }));
      }
    });

    it("rejects invalid values", async () => {
      const ref = doc(alice, P.user(ALICE));
      await assertFails(updateDoc(ref, { style: "gothic" }));
      await assertFails(updateDoc(ref, { animal: "dragon" }));
      await assertFails(updateDoc(ref, { nativeLang: "x".repeat(100) }));
      await assertFails(updateDoc(ref, { "colors.shirt": { swatch: "neon" } }));
      await assertFails(updateDoc(ref, { "colors.shirt": { h: 10, s: 1, l: 0.5 } }));
      await assertFails(updateDoc(ref, { "colors.extra": true }));
    });

    it("clients cannot create, overwrite another user's or delete profiles", async () => {
      await assertFails(setDoc(doc(bob, P.user(BOB)), { ...profile(), name: "Bob" }));
      await assertFails(updateDoc(doc(bob, P.user(ALICE)), { style: "european" }));
      await assertFails(deleteDoc(doc(alice, P.user(ALICE))));
    });
  });

  describe("users/{uid}/langs/{lang}", () => {
    it("the owner reads it and may change only settings", async () => {
      const ref = doc(alice, P.lang(ALICE, "ja"));
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(updateDoc(ref, { settings: { scriptMode: "both" } }));
      await assertFails(updateDoc(ref, { settings: { scriptMode: "kana" } }));
      await assertFails(updateDoc(ref, { settings: { scriptMode: "both", coins: 1 } }));
    });

    it("coins, hearts, level and streak are server-only", async () => {
      const ref = doc(alice, P.lang(ALICE, "ja"));
      await assertFails(updateDoc(ref, { coins: 1_000_000 }));
      await assertFails(updateDoc(ref, { "hearts.baker": 10 }));
      await assertFails(updateDoc(ref, { level: "C2" }));
      await assertFails(updateDoc(ref, { levelEstimate: 10 }));
      await assertFails(updateDoc(ref, { streak: 365 }));
      await assertFails(setDoc(doc(alice, P.lang(ALICE, "fr")), progress()));
      await assertFails(deleteDoc(ref));
    });

    it("other users cannot read or write it", async () => {
      await assertFails(getDoc(doc(bob, P.lang(ALICE, "ja"))));
      await assertFails(updateDoc(doc(bob, P.lang(ALICE, "ja")), { settings: {} }));
    });
  });

  describe("notebook", () => {
    it("the owner can create, list, update and delete entries", async () => {
      const ref = doc(alice, P.notebookEntry(ALICE, "ja", "e2"));
      await assertSucceeds(setDoc(ref, entry()));
      await assertSucceeds(getDocs(collection(alice, P.notebook(ALICE, "ja"))));
      await assertSucceeds(updateDoc(ref, { gloss: "bread (loaf)", updatedAt: serverTimestamp() }));
      await assertSucceeds(deleteDoc(ref));
    });

    it("validates entries on create and update", async () => {
      const ref = doc(alice, P.notebookEntry(ALICE, "ja", "e3"));
      await assertFails(setDoc(ref, { ...entry(), surface: "" }));
      await assertFails(setDoc(ref, { ...entry(), gloss: "x".repeat(501) }));
      await assertFails(setDoc(ref, { ...entry(), source: "evil" }));
      await assertFails(setDoc(ref, { ...entry(), coins: 5 }));
      await assertFails(setDoc(ref, { ...entry(), createdAt: Timestamp.fromMillis(0) }));
      const existing = doc(alice, P.notebookEntry(ALICE, "ja", "e1"));
      await assertFails(updateDoc(existing, { surface: "x".repeat(201), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(existing, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
      await assertFails(updateDoc(existing, { gloss: "no timestamp" }));
    });

    it("needs an existing language and the owner", async () => {
      await assertFails(setDoc(doc(alice, P.notebookEntry(ALICE, "fr", "e1")), entry()));
      await assertFails(setDoc(doc(bob, P.notebookEntry(ALICE, "ja", "e4")), entry()));
      await assertFails(getDoc(doc(bob, P.notebookEntry(ALICE, "ja", "e1"))));
    });
  });

  describe("server-only subcollections", () => {
    const paths = [
      P.npcMemory(ALICE, "ja", "baker"),
      P.inventorySlot(ALICE, "0"),
      P.apartmentLayout(ALICE),
    ];

    it("the owner can read them", async () => {
      for (const path of paths) await assertSucceeds(getDoc(doc(alice, path)));
    });

    it("nobody can write them from a client, and others cannot read them", async () => {
      for (const path of paths) {
        await assertFails(setDoc(doc(alice, path), { hacked: true }));
        await assertFails(deleteDoc(doc(alice, path)));
        await assertFails(getDoc(doc(bob, path)));
      }
      await assertFails(setDoc(doc(alice, P.inventorySlot(ALICE, "1")), { itemId: "golden_rod", qty: 99 }));
    });
  });

  describe("village/*", () => {
    it("is readable by signed-in users only", async () => {
      await assertSucceeds(getDoc(doc(bob, P.villageEvent("shard-1", "ev1"))));
      await assertSucceeds(getDocs(collection(bob, "village/shard-1/events")));
      await assertFails(getDoc(doc(anon, P.villageEvent("shard-1", "ev1"))));
    });

    it("is never writable by clients, even admins", async () => {
      const event = { type: "fish_caught", payload: {}, ts: Timestamp.now() };
      await assertFails(setDoc(doc(bob, P.villageEvent("shard-1", "ev2")), event));
      await assertFails(setDoc(doc(admin, P.villageEvent("shard-1", "ev2")), event));
      await assertFails(deleteDoc(doc(bob, P.villageEvent("shard-1", "ev1"))));
    });
  });

  describe("cache/*", () => {
    it("is readable by signed-in users only", async () => {
      await assertSucceeds(getDoc(doc(bob, P.cacheEntry("lines", "h1"))));
      await assertFails(getDoc(doc(anon, P.cacheEntry("lines", "h1"))));
    });

    it("is writable only with the admin claim", async () => {
      await assertFails(setDoc(doc(bob, P.cacheEntry("lines", "h2")), { text: "poisoned" }));
      await assertFails(updateDoc(doc(bob, P.cacheEntry("lines", "h1")), { text: "poisoned" }));
      await assertFails(setDoc(doc(db(env.authenticatedContext("eve", { admin: "true" })), P.cacheEntry("tts", "h")), {}));
      await assertSucceeds(setDoc(doc(admin, P.cacheEntry("tts", "h2")), { storagePath: "tts/x.ogg", voice: "Kore", durationMs: 1 }));
      await assertSucceeds(setDoc(doc(admin, P.cacheEntry("labels", "ja")), {}));
      await assertFails(setDoc(doc(admin, "cache/other/h3"), { text: "x" }));
    });
  });

  describe("everything else", () => {
    it("is denied", async () => {
      await assertFails(getDoc(doc(alice, P.report("r1"))));
      await assertFails(setDoc(doc(alice, P.report("r2")), { reason: "x" }));
      await assertFails(getDoc(doc(alice, "secrets/x")));
      await assertFails(setDoc(doc(admin, "secrets/x"), { a: 1 }));
    });
  });
});
