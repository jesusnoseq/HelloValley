import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import {
  applyItemDeltas,
  Collection,
  FirestorePaths,
  InventorySlotSchema,
  type ItemDelta,
  LangProgressSchema,
  type Level,
  MAX_HEARTS,
  NotebookEntrySchema,
  type NpcId,
  NpcMemorySchema,
  type SlotEntry,
  TOTAL_SLOTS,
  type TradeFailure,
} from "@hellovalley/shared";

/**
 * What the NPC dialogue service reads and writes (build plan M21, architecture §6.2): the
 * player's level, coins and hearts (`users/{uid}/langs/{lang}`), the NPC's memory of them
 * (`…/npcMemory/{npcId}`), recent notebook words and the inventory (`users/{uid}/inventory/{slot}`).
 * Economy writes go through the Admin SDK in one transaction per accepted change.
 */
export interface NpcPlayerRecord {
  level: Level;
  coins: number;
  /** Hearts with the NPC asked about. */
  hearts: number;
  memory: { summary: string; facts: string[] } | null;
  learningWords: string[];
  slots: SlotEntry[];
  /** TODO(M29): learned-recipe storage. */
  knownRecipes: string[];
}

export interface PlayerChange {
  npcId: NpcId;
  /** Coin change (negative: the player pays). The balance never goes below 0. */
  coins: number;
  items: ItemDelta[];
  /** Hearts change with `npcId` (kept within 0..10). */
  hearts: number;
}

export type ApplyResult = { ok: true; coins: number; hearts: number; slots: SlotEntry[] } | { ok: false; reason: TradeFailure };

export interface NpcStore {
  /** The player's records for a conversation, or null when `langs/{lang}` does not exist. */
  load(uid: string, lang: string, npcId: NpcId): Promise<NpcPlayerRecord | null>;
  /** Applies a change atomically, re-checking coins and inventory inside the transaction. */
  apply(uid: string, lang: string, change: PlayerChange): Promise<ApplyResult>;
}

/** Notebook words passed to NPCs (build plan M25: up to 5). TODO(M25): pick "learning" cards by FSRS state. */
export const LEARNING_WORDS_LIMIT = 5;

const clampHearts = (h: number) => Math.min(MAX_HEARTS, Math.max(0, h));

function computeChange(coins: number, hearts: number, slots: SlotEntry[], change: PlayerChange) {
  if (coins + change.coins < 0) return { ok: false as const, reason: "insufficient_coins" as const };
  const items = applyItemDeltas(slots, change.items, TOTAL_SLOTS);
  if (!items.ok) return items;
  return { ok: true as const, coins: coins + change.coins, hearts: clampHearts(hearts + change.hearts), slots: items.slots, changed: items.changed };
}

export function createFirestoreNpcStore(db: Firestore): NpcStore {
  const inventory = (uid: string) => db.collection(`${FirestorePaths.user(uid)}/${Collection.Inventory}`);
  const readSlots = (docs: { id: string; data(): unknown }[]): SlotEntry[] =>
    docs.flatMap((d) => {
      const slot = Number(d.id);
      const parsed = InventorySlotSchema.safeParse(d.data());
      // A slot that does not parse is skipped (and never written back), not fatal.
      return Number.isInteger(slot) && slot >= 0 && slot < TOTAL_SLOTS && parsed.success ? [{ slot, ...parsed.data }] : [];
    });

  return {
    async load(uid, lang, npcId) {
      const [langSnap, memorySnap, notebookSnap, inventorySnap] = await Promise.all([
        db.doc(FirestorePaths.lang(uid, lang)).get(),
        db.doc(FirestorePaths.npcMemory(uid, lang, npcId)).get(),
        db.collection(FirestorePaths.notebook(uid, lang)).orderBy("createdAt", "desc").limit(LEARNING_WORDS_LIMIT).get(),
        inventory(uid).get(),
      ]);
      if (!langSnap.exists) return null;
      const progress = LangProgressSchema.parse(langSnap.data());
      const memory = memorySnap.exists ? NpcMemorySchema.safeParse(memorySnap.data()) : null;
      const learningWords = notebookSnap.docs.flatMap((d) => {
        const entry = NotebookEntrySchema.safeParse(d.data());
        return entry.success ? [entry.data.surface] : [];
      });
      return {
        level: progress.level,
        coins: progress.coins,
        hearts: progress.hearts[npcId] ?? 0,
        memory: memory?.success ? { summary: memory.data.summary, facts: memory.data.facts } : null,
        learningWords,
        slots: readSlots(inventorySnap.docs),
        knownRecipes: [],
      };
    },
    async apply(uid, lang, change) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      return db.runTransaction(async (tx) => {
        const [langSnap, invSnap] = await Promise.all([tx.get(langRef), tx.get(inventory(uid))]);
        if (!langSnap.exists) throw new Error(`users/${uid}/langs/${lang} does not exist`);
        const progress = LangProgressSchema.parse(langSnap.data());
        const result = computeChange(progress.coins, progress.hearts[change.npcId] ?? 0, readSlots(invSnap.docs), change);
        if (!result.ok) return result;
        tx.update(langRef, { coins: result.coins, [`hearts.${change.npcId}`]: result.hearts });
        const bySlot = new Map(result.slots.map((s) => [s.slot, s]));
        for (const slot of result.changed) {
          const ref = db.doc(FirestorePaths.inventorySlot(uid, String(slot)));
          const entry = bySlot.get(slot);
          if (entry) tx.set(ref, InventorySlotSchema.parse({ itemId: entry.itemId, qty: entry.qty }));
          else tx.delete(ref);
        }
        return { ok: true, coins: result.coins, hearts: result.hearts, slots: result.slots };
      });
    },
  };
}

export function firestoreNpcStoreFor(app: App): NpcStore {
  return createFirestoreNpcStore(getFirestore(app));
}

/** An in-memory store for tests and local runs without Firestore. */
export interface MemoryNpcStore extends NpcStore {
  readonly players: Map<string, MemoryPlayer>;
}

export interface MemoryPlayer {
  level: Level;
  coins: number;
  hearts: Partial<Record<NpcId, number>>;
  memory?: Partial<Record<NpcId, { summary: string; facts: string[] }>>;
  learningWords?: string[];
  slots: SlotEntry[];
}

/** Keyed by `${uid}/${lang}`. */
export function createMemoryNpcStore(initial: Record<string, MemoryPlayer> = {}): MemoryNpcStore {
  const players = new Map(Object.entries(initial));
  return {
    players,
    async load(uid, lang, npcId) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) return null;
      return {
        level: p.level,
        coins: p.coins,
        hearts: p.hearts[npcId] ?? 0,
        memory: p.memory?.[npcId] ?? null,
        learningWords: (p.learningWords ?? []).slice(0, LEARNING_WORDS_LIMIT),
        slots: p.slots.map((s) => ({ ...s })),
        knownRecipes: [],
      };
    },
    async apply(uid, lang, change) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) throw new Error(`no player ${uid}/${lang}`);
      const result = computeChange(p.coins, p.hearts[change.npcId] ?? 0, p.slots, change);
      if (!result.ok) return result;
      p.coins = result.coins;
      p.hearts[change.npcId] = result.hearts;
      p.slots = result.slots;
      return { ok: true, coins: result.coins, hearts: result.hearts, slots: result.slots.map((s) => ({ ...s })) };
    },
  };
}
