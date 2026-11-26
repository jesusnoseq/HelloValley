import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  type AlbumEntry,
  applyItemDeltas,
  applyLostReturn,
  cleanAlbum,
  type CollectibleId,
  Collection,
  emptyAlbum,
  FirestorePaths,
  type ForageAlbum,
  type ForageAlbumDoc,
  ForageAlbumDocSchema,
  InventorySlotSchema,
  isLostItemId,
  itemCounts,
  LangProgressSchema,
  type LostItemId,
  type LostReturnRefusal,
  newBond,
  type NpcId,
  recordFind,
  recordReturn,
  type ReturnedEntry,
  type SlotEntry,
  type TimestampLike,
  TOTAL_SLOTS,
} from "@hellovalley/shared";
import type { MemoryNpcStore } from "../npc/npcStore";

/**
 * What foraging reads and writes (build plan M28): the inventory (a find goes into the bag, a
 * returned lost item leaves it), the hearts with the lost item's owner (`users/{uid}/langs/{lang}`)
 * and the forage album in `users/{uid}/collections/forage`. A find adds the item and updates the
 * album in one Admin SDK transaction; with a full bag nothing happens and the spawn stays. A return
 * takes the item, adds the hearts (shared `applyLostReturn`) and counts the return in the album in
 * one transaction. No security rule matches `collections/*`, so clients can neither read nor write
 * the album (the room sends it).
 */

export type FindOutcome =
  | { ok: true; first: boolean; entry: AlbumEntry; album: ForageAlbum; slots: SlotEntry[] }
  | { ok: false; reason: "bag_full" | "already_have" };

export type ReturnOutcome =
  | { ok: true; delta: number; rewarded: boolean; hearts: number; slots: SlotEntry[]; album: ForageAlbum }
  | { ok: false; reason: LostReturnRefusal | "not_owned"; hearts: number; slots: SlotEntry[] };

export interface ForageStore {
  /** The album (empty when there is none yet). */
  album(uid: string): Promise<ForageAlbum>;
  /** A pick-up: into the bag and the album. Null: no `langs/{lang}`. */
  recordFind(uid: string, lang: string, itemId: CollectibleId, nowMs: number): Promise<FindOutcome | null>;
  /** A lost item goes back to `npcId` on in-game day `today`. Null: no `langs/{lang}`. */
  returnLost(uid: string, lang: string, npcId: NpcId, itemId: LostItemId, today: number): Promise<ReturnOutcome | null>;
}

const millis = (t: TimestampLike) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);

function albumFromDoc(data: unknown): ForageAlbum {
  const parsed = ForageAlbumDocSchema.safeParse(data);
  if (!parsed.success) return emptyAlbum();
  const found: Record<string, AlbumEntry> = {};
  for (const [id, e] of Object.entries(parsed.data.found)) if (e) found[id] = { count: e.count, firstMs: millis(e.first), lastMs: millis(e.last) };
  const returned: Record<string, ReturnedEntry> = {};
  for (const [id, e] of Object.entries(parsed.data.returned)) if (e) returned[id] = { count: e.count, lastDay: e.lastDay };
  return cleanAlbum({ found, returned });
}

function docFromAlbum(album: ForageAlbum): ForageAlbumDoc {
  const found: ForageAlbumDoc["found"] = {};
  for (const [id, e] of Object.entries(album.found) as [CollectibleId, AlbumEntry][]) {
    found[id] = { count: e.count, first: Timestamp.fromMillis(e.firstMs), last: Timestamp.fromMillis(e.lastMs) };
  }
  return ForageAlbumDocSchema.parse({ found, returned: { ...album.returned } });
}

/** The pure part of a find, shared by both stores. */
function computeFind(slots: SlotEntry[], album: ForageAlbum, itemId: CollectibleId, nowMs: number) {
  // One copy of a lost item at a time: the others stay for other players.
  if (isLostItemId(itemId) && (itemCounts(slots)[itemId] ?? 0) > 0) return { ok: false as const, reason: "already_have" as const };
  const items = applyItemDeltas(slots, [{ itemId, qty: 1 }], TOTAL_SLOTS);
  if (!items.ok) return { ok: false as const, reason: "bag_full" as const };
  return { ok: true as const, items, found: recordFind(album, itemId, nowMs) };
}

/** The pure part of a return. */
function computeReturn(slots: SlotEntry[], hearts: number, album: ForageAlbum, npcId: NpcId, itemId: LostItemId, today: number) {
  const outcome = applyLostReturn(newBond(hearts), npcId, itemId, album.returned[itemId]?.lastDay ?? null, today);
  if (!outcome.ok) return outcome;
  const items = applyItemDeltas(slots, [{ itemId, qty: -1 }], TOTAL_SLOTS);
  if (!items.ok) return { ok: false as const, reason: "not_owned" as const };
  return { ok: true as const, outcome, items, album: recordReturn(album, itemId, today) };
}

export function createFirestoreForageStore(db: Firestore): ForageStore {
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
    async album(uid) {
      const snap = await db.doc(FirestorePaths.forageAlbum(uid)).get();
      return snap.exists ? albumFromDoc(snap.data()) : emptyAlbum();
    },
    async recordFind(uid, lang, itemId, nowMs) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      const albumRef = db.doc(FirestorePaths.forageAlbum(uid));
      return db.runTransaction(async (tx): Promise<FindOutcome | null> => {
        const [langSnap, invSnap, albumSnap] = await Promise.all([tx.get(langRef), tx.get(inventory(uid)), tx.get(albumRef)]);
        if (!langSnap.exists) return null;
        const result = computeFind(readSlots(invSnap.docs), albumSnap.exists ? albumFromDoc(albumSnap.data()) : emptyAlbum(), itemId, nowMs);
        if (!result.ok) return result;
        writeSlots(tx, uid, result.items.slots, result.items.changed);
        tx.set(albumRef, docFromAlbum(result.found.album));
        return { ok: true, first: result.found.first, entry: result.found.entry, album: result.found.album, slots: result.items.slots };
      });
    },
    async returnLost(uid, lang, npcId, itemId, today) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      const albumRef = db.doc(FirestorePaths.forageAlbum(uid));
      return db.runTransaction(async (tx): Promise<ReturnOutcome | null> => {
        const [langSnap, invSnap, albumSnap] = await Promise.all([tx.get(langRef), tx.get(inventory(uid)), tx.get(albumRef)]);
        if (!langSnap.exists) return null;
        const progress = LangProgressSchema.parse(langSnap.data());
        const hearts = progress.hearts[npcId] ?? 0;
        const slots = readSlots(invSnap.docs);
        const result = computeReturn(slots, hearts, albumSnap.exists ? albumFromDoc(albumSnap.data()) : emptyAlbum(), npcId, itemId, today);
        if (!result.ok) return { ok: false, reason: result.reason, hearts, slots };
        const next = result.outcome.bond.hearts;
        if (next !== hearts) tx.update(langRef, { [`hearts.${npcId}`]: next });
        writeSlots(tx, uid, result.items.slots, result.items.changed);
        tx.set(albumRef, docFromAlbum(result.album));
        return { ok: true, delta: result.outcome.delta, rewarded: result.outcome.rewarded, hearts: next, slots: result.items.slots, album: result.album };
      });
    },
  };
}

export function firestoreForageStoreFor(app: App): ForageStore {
  return createFirestoreForageStore(getFirestore(app));
}

export interface MemoryForageStore extends ForageStore {
  readonly albums: Map<string, ForageAlbum>;
}

/** In memory, over the in-memory NPC store's players (so trades, catches and finds share one inventory and the hearts). */
export function createMemoryForageStore(npcStore: MemoryNpcStore, initial: Record<string, ForageAlbum> = {}): MemoryForageStore {
  const albums = new Map(Object.entries(initial));
  const copy = (slots: SlotEntry[]) => slots.map((s) => ({ ...s }));
  return {
    albums,
    async album(uid) {
      return structuredClone(albums.get(uid) ?? emptyAlbum());
    },
    async recordFind(uid, lang, itemId, nowMs) {
      const p = npcStore.players.get(`${uid}/${lang}`);
      if (!p) return null;
      const result = computeFind(p.slots, albums.get(uid) ?? emptyAlbum(), itemId, nowMs);
      if (!result.ok) return result;
      p.slots = result.items.slots;
      albums.set(uid, result.found.album);
      return { ok: true, first: result.found.first, entry: result.found.entry, album: structuredClone(result.found.album), slots: copy(p.slots) };
    },
    async returnLost(uid, lang, npcId, itemId, today) {
      const p = npcStore.players.get(`${uid}/${lang}`);
      if (!p) return null;
      const hearts = p.hearts[npcId] ?? 0;
      const result = computeReturn(p.slots, hearts, albums.get(uid) ?? emptyAlbum(), npcId, itemId, today);
      if (!result.ok) return { ok: false, reason: result.reason, hearts, slots: copy(p.slots) };
      p.slots = result.items.slots;
      p.hearts[npcId] = result.outcome.bond.hearts;
      albums.set(uid, result.album);
      return { ok: true, delta: result.outcome.delta, rewarded: result.outcome.rewarded, hearts: result.outcome.bond.hearts, slots: copy(p.slots), album: structuredClone(result.album) };
    },
  };
}
