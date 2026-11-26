import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  Collection,
  cookRecipe,
  type CookOutcome,
  emptyRecipeBook,
  type EatRefusal,
  FirestorePaths,
  InventorySlotSchema,
  type ItemId,
  judgeEat,
  learnRecipes,
  type NpcId,
  type RecipeBook,
  type RecipeBookDoc,
  RecipeBookDocSchema,
  type RecipeBookEntry,
  type RecipeId,
  type SlotEntry,
  type TimestampLike,
  TOTAL_SLOTS,
} from "@hellovalley/shared";
import type { MemoryNpcStore } from "../npc/npcStore";

/**
 * What eating and cooking read and write (build plan M29, architecture §6.2): the inventory (a
 * bite leaves the hotbar slot, cooking turns ingredients into the dish) and the recipe book in
 * `users/{uid}/collections/recipes` (filled by accepted `teachRecipe` actions). Every change is one
 * Admin SDK transaction; the rules are the pure shared functions (food/eating.ts, food/cooking.ts).
 * No security rule matches `collections/*`, so clients can neither read nor write the book (the
 * room sends it).
 */

export type EatOutcome = { ok: true; itemId: ItemId; slots: SlotEntry[] } | { ok: false; reason: Exclude<EatRefusal, "cooldown" | "busy" | "unavailable"> };

export interface FoodStore {
  /** The recipe book (empty when there is none yet). */
  book(uid: string): Promise<RecipeBook>;
  /** Adds recipes an NPC taught (already known ones stay as they are). */
  learn(uid: string, recipeIds: readonly string[], teacher: NpcId, lang: string, nowMs: number): Promise<{ book: RecipeBook; learned: RecipeId[] }>;
  /** Cooks one dish (`cookRecipe`) in one transaction. */
  cook(uid: string, lang: string, recipeId: string): Promise<CookOutcome>;
  /** Takes one bite from a hotbar slot (`judgeEat`) in one transaction. */
  eat(uid: string, lang: string, slot: number): Promise<EatOutcome>;
}

const millis = (t: TimestampLike) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);

function bookFromDoc(data: unknown): RecipeBook {
  const parsed = RecipeBookDocSchema.safeParse(data);
  if (!parsed.success) return emptyRecipeBook();
  const known: RecipeBook["known"] = {};
  for (const [id, e] of Object.entries(parsed.data.known) as [RecipeId, NonNullable<RecipeBookDoc["known"][RecipeId]>][]) {
    known[id] = { teacher: e.teacher, lang: e.lang, learnedMs: millis(e.learned), cooked: e.cooked };
  }
  return { known };
}

function docFromBook(book: RecipeBook): RecipeBookDoc {
  const known: RecipeBookDoc["known"] = {};
  for (const [id, e] of Object.entries(book.known) as [RecipeId, RecipeBookEntry][]) {
    known[id] = { teacher: e.teacher, lang: e.lang, learned: Timestamp.fromMillis(e.learnedMs), cooked: e.cooked };
  }
  return RecipeBookDocSchema.parse({ known });
}

export function createFirestoreFoodStore(db: Firestore): FoodStore {
  const inventory = (uid: string) => db.collection(`${FirestorePaths.user(uid)}/${Collection.Inventory}`);
  const readSlots = (docs: { id: string; data(): unknown }[]): SlotEntry[] =>
    docs.flatMap((d) => {
      const slot = Number(d.id);
      const parsed = InventorySlotSchema.safeParse(d.data());
      return Number.isInteger(slot) && slot >= 0 && slot < TOTAL_SLOTS && parsed.success ? [{ slot, ...parsed.data }] : [];
    });
  const writeSlots = (tx: Transaction, uid: string, slots: SlotEntry[], changed: number[]) => {
    const bySlot = new Map(slots.map((s) => [s.slot, s]));
    for (const slot of changed) {
      const ref = db.doc(FirestorePaths.inventorySlot(uid, String(slot)));
      const entry = bySlot.get(slot);
      if (entry) tx.set(ref, InventorySlotSchema.parse({ itemId: entry.itemId, qty: entry.qty }));
      else tx.delete(ref);
    }
  };
  return {
    async book(uid) {
      const snap = await db.doc(FirestorePaths.recipeBook(uid)).get();
      return snap.exists ? bookFromDoc(snap.data()) : emptyRecipeBook();
    },
    async learn(uid, recipeIds, teacher, lang, nowMs) {
      const ref = db.doc(FirestorePaths.recipeBook(uid));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const result = learnRecipes(snap.exists ? bookFromDoc(snap.data()) : emptyRecipeBook(), recipeIds, teacher, lang, nowMs);
        if (result.learned.length) tx.set(ref, docFromBook(result.book));
        return result;
      });
    },
    async cook(uid, _lang, recipeId) {
      const ref = db.doc(FirestorePaths.recipeBook(uid));
      return db.runTransaction(async (tx): Promise<CookOutcome> => {
        const [bookSnap, invSnap] = await Promise.all([tx.get(ref), tx.get(inventory(uid))]);
        const result = cookRecipe(readSlots(invSnap.docs), bookSnap.exists ? bookFromDoc(bookSnap.data()) : emptyRecipeBook(), recipeId);
        if (!result.ok) return result;
        writeSlots(tx, uid, result.slots, result.changed);
        tx.set(ref, docFromBook(result.book));
        return result;
      });
    },
    async eat(uid, _lang, slot) {
      const ref = db.doc(FirestorePaths.inventorySlot(uid, String(slot)));
      return db.runTransaction(async (tx): Promise<EatOutcome> => {
        const snap = await tx.get(ref);
        const parsed = snap.exists ? InventorySlotSchema.safeParse(snap.data()) : null;
        const slots: SlotEntry[] = parsed?.success ? [{ slot, ...parsed.data }] : [];
        const verdict = judgeEat(slots, slot);
        if (!verdict.ok) return { ok: false, reason: verdict.reason === "not_hotbar" || verdict.reason === "not_food" ? verdict.reason : "empty_slot" };
        writeSlots(tx, uid, verdict.slots, verdict.changed);
        return { ok: true, itemId: verdict.itemId, slots: verdict.slots };
      });
    },
  };
}

export function firestoreFoodStoreFor(app: App): FoodStore {
  return createFirestoreFoodStore(getFirestore(app));
}

export interface MemoryFoodStore extends FoodStore {
  readonly books: Map<string, RecipeBook>;
}

/** In memory, over the in-memory NPC store's players (so trades, catches, finds and dishes share one inventory). */
export function createMemoryFoodStore(npcStore: MemoryNpcStore, initial: Record<string, RecipeBook> = {}): MemoryFoodStore {
  const books = new Map(Object.entries(initial));
  const playerOf = (uid: string, lang: string) => npcStore.players.get(`${uid}/${lang}`);
  return {
    books,
    async book(uid) {
      return structuredClone(books.get(uid) ?? emptyRecipeBook());
    },
    async learn(uid, recipeIds, teacher, lang, nowMs) {
      const result = learnRecipes(books.get(uid) ?? emptyRecipeBook(), recipeIds, teacher, lang, nowMs);
      books.set(uid, result.book);
      return structuredClone(result);
    },
    async cook(uid, lang, recipeId) {
      const p = playerOf(uid, lang);
      if (!p) throw new Error(`no player ${uid}/${lang}`);
      const result = cookRecipe(p.slots, books.get(uid) ?? emptyRecipeBook(), recipeId);
      if (!result.ok) return result;
      p.slots = result.slots;
      books.set(uid, result.book);
      return structuredClone(result);
    },
    async eat(uid, lang, slot) {
      const p = playerOf(uid, lang);
      if (!p) throw new Error(`no player ${uid}/${lang}`);
      const verdict = judgeEat(p.slots, slot);
      if (!verdict.ok) return { ok: false, reason: verdict.reason === "not_hotbar" || verdict.reason === "not_food" ? verdict.reason : "empty_slot" };
      p.slots = verdict.slots;
      return { ok: true, itemId: verdict.itemId, slots: verdict.slots.map((s) => ({ ...s })) };
    },
  };
}
