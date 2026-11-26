import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  applyItemDeltas,
  cleanFishLog,
  Collection,
  FirestorePaths,
  type FishId,
  type FishLog,
  type FishLogDoc,
  FishLogDocSchema,
  type FishLogEntry,
  InventorySlotSchema,
  LangProgressSchema,
  recordCatch,
  type SlotEntry,
  type TimestampLike,
  TOTAL_SLOTS,
} from "@hellovalley/shared";
import type { MemoryNpcStore } from "../npc/npcStore";

/**
 * What fishing reads and writes (build plan M27): the inventory (the rod in the hotbar, the catch
 * going into the bag), the Elder's hearts (the secret spot) and the fish encyclopedia in
 * `users/{uid}/collections/fish`. A catch adds the fish and updates the encyclopedia in one Admin
 * SDK transaction; with a full bag the fish is released but still counts as caught. No security
 * rule matches `collections/*`, so clients can neither read nor write it (the room sends it).
 */

export interface FishingContext {
  slots: SlotEntry[];
  elderHearts: number;
}

export interface CatchOutcome {
  /** The fish went into the bag (false: no room, released). */
  kept: boolean;
  first: boolean;
  entry: FishLogEntry;
  log: FishLog;
  slots: SlotEntry[];
}

export interface FishingStore {
  /** The inventory and the Elder's hearts, or null when the player has no `langs/{lang}`. */
  context(uid: string, lang: string): Promise<FishingContext | null>;
  /** The encyclopedia (empty when there is none yet). */
  log(uid: string): Promise<FishLog>;
  /** Lands a fish: into the bag if it fits, and into the encyclopedia. Null: no `langs/{lang}`. */
  recordCatch(uid: string, lang: string, fishId: FishId, nowMs: number): Promise<CatchOutcome | null>;
}

const millis = (t: TimestampLike) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);

function logFromDoc(data: unknown): FishLog {
  const parsed = FishLogDocSchema.safeParse(data);
  if (!parsed.success) return {};
  const raw: Record<string, FishLogEntry> = {};
  for (const [id, e] of Object.entries(parsed.data.species)) if (e) raw[id] = { count: e.count, firstMs: millis(e.first), lastMs: millis(e.last) };
  return cleanFishLog(raw);
}

function docFromLog(log: FishLog): FishLogDoc {
  const species: FishLogDoc["species"] = {};
  for (const [id, e] of Object.entries(log) as [FishId, FishLogEntry][]) {
    species[id] = { count: e.count, first: Timestamp.fromMillis(e.firstMs), last: Timestamp.fromMillis(e.lastMs) };
  }
  return FishLogDocSchema.parse({ species });
}

export function createFirestoreFishingStore(db: Firestore): FishingStore {
  const inventory = (uid: string) => db.collection(`${FirestorePaths.user(uid)}/${Collection.Inventory}`);
  const readSlots = (docs: { id: string; data(): unknown }[]): SlotEntry[] =>
    docs.flatMap((d) => {
      const slot = Number(d.id);
      const parsed = InventorySlotSchema.safeParse(d.data());
      return Number.isInteger(slot) && slot >= 0 && slot < TOTAL_SLOTS && parsed.success ? [{ slot, ...parsed.data }] : [];
    });
  return {
    async context(uid, lang) {
      const [langSnap, invSnap] = await Promise.all([db.doc(FirestorePaths.lang(uid, lang)).get(), inventory(uid).get()]);
      if (!langSnap.exists) return null;
      const progress = LangProgressSchema.parse(langSnap.data());
      return { slots: readSlots(invSnap.docs), elderHearts: progress.hearts.elder ?? 0 };
    },
    async log(uid) {
      const snap = await db.doc(FirestorePaths.fishLog(uid)).get();
      return snap.exists ? logFromDoc(snap.data()) : {};
    },
    async recordCatch(uid, lang, fishId, nowMs) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      const logRef = db.doc(FirestorePaths.fishLog(uid));
      return db.runTransaction(async (tx): Promise<CatchOutcome | null> => {
        const [langSnap, invSnap, logSnap] = await Promise.all([tx.get(langRef), tx.get(inventory(uid)), tx.get(logRef)]);
        if (!langSnap.exists) return null;
        const slots = readSlots(invSnap.docs);
        const items = applyItemDeltas(slots, [{ itemId: fishId, qty: 1 }], TOTAL_SLOTS);
        const caught = recordCatch(logSnap.exists ? logFromDoc(logSnap.data()) : {}, fishId, nowMs);
        if (items.ok) {
          const bySlot = new Map(items.slots.map((s) => [s.slot, s]));
          for (const slot of items.changed) {
            const entry = bySlot.get(slot)!;
            tx.set(db.doc(FirestorePaths.inventorySlot(uid, String(slot))), InventorySlotSchema.parse({ itemId: entry.itemId, qty: entry.qty }));
          }
        }
        tx.set(logRef, docFromLog(caught.log));
        return { kept: items.ok, first: caught.first, entry: caught.entry, log: caught.log, slots: items.ok ? items.slots : slots };
      });
    },
  };
}

export function firestoreFishingStoreFor(app: App): FishingStore {
  return createFirestoreFishingStore(getFirestore(app));
}

export interface MemoryFishingStore extends FishingStore {
  readonly logs: Map<string, FishLog>;
}

/** In memory, over the in-memory NPC store's players (so trades, moves and catches share one inventory). */
export function createMemoryFishingStore(npcStore: MemoryNpcStore, initial: Record<string, FishLog> = {}): MemoryFishingStore {
  const logs = new Map(Object.entries(initial));
  return {
    logs,
    async context(uid, lang) {
      const p = npcStore.players.get(`${uid}/${lang}`);
      return p ? { slots: p.slots.map((s) => ({ ...s })), elderHearts: p.hearts.elder ?? 0 } : null;
    },
    async log(uid) {
      return { ...logs.get(uid) };
    },
    async recordCatch(uid, lang, fishId, nowMs) {
      const p = npcStore.players.get(`${uid}/${lang}`);
      if (!p) return null;
      const items = applyItemDeltas(p.slots, [{ itemId: fishId, qty: 1 }], TOTAL_SLOTS);
      if (items.ok) p.slots = items.slots;
      const caught = recordCatch(logs.get(uid) ?? {}, fishId, nowMs);
      logs.set(uid, caught.log);
      return { kept: items.ok, first: caught.first, entry: caught.entry, log: { ...caught.log }, slots: p.slots.map((s) => ({ ...s })) };
    },
  };
}
