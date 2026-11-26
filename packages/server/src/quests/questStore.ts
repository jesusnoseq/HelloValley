import type { App } from "firebase-admin/app";
import { FieldPath, type Firestore, getFirestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  Collection,
  FirestorePaths,
  InventorySlotSchema,
  LangProgressSchema,
  type Level,
  type NpcId,
  type Quest,
  type QuestClock,
  type QuestEntry,
  type QuestLog,
  type QuestLogLangDoc,
  QuestLogDocSchema,
  QuestLogLangSchema,
  type QuestSettlement,
  settleQuest,
  type SlotEntry,
  type TimestampLike,
  TOTAL_SLOTS,
} from "@hellovalley/shared";
import type { MemoryNpcStore } from "../npc/npcStore";

/**
 * What the quest service reads and writes (build plan M30, architecture §6.2): the quest log per
 * target language in `users/{uid}/collections/quests` (server-only: no security rule matches
 * `collections/*`), and, when a request is completed, the coins and the hearts with the requester
 * (`users/{uid}/langs/{lang}`) and the inventory, all in one Admin SDK transaction through the
 * shared `settleQuest`. The requests themselves are never stored: they are recomputed from
 * (uid, language, in-game day) (quests/board.ts).
 */

export interface QuestStore {
  /** The player's quest log in `lang`, or null when there is none yet. */
  log(uid: string, lang: string): Promise<QuestLog | null>;
  /** The player's level in `lang` (the notices are written at its band), or null without `langs/{lang}`. */
  level(uid: string, lang: string): Promise<Level | null>;
  /**
   * Changes the log in one transaction: `fn` gets the stored log (or null) and returns the new
   * one (null: nothing to write) plus a result for the caller.
   */
  update<T>(uid: string, lang: string, fn: (log: QuestLog | null) => { log: QuestLog | null; result: T }): Promise<T>;
  /** Completes a request (`settleQuest`) with the coins, hearts and bag in one transaction. Null: no `langs/{lang}`. */
  settle(uid: string, lang: string, quest: Quest, npcId: NpcId | null, clock: QuestClock): Promise<QuestSettlement | null>;
}

const millis = (t: TimestampLike) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);

function logFromDoc(data: unknown): QuestLog | null {
  const parsed = QuestLogLangSchema.safeParse(data);
  if (!parsed.success) return null;
  const entries: Record<string, QuestEntry> = {};
  for (const [id, e] of Object.entries(parsed.data.entries)) {
    entries[id] = { status: e.status, progress: e.progress, acceptedMs: millis(e.accepted), via: e.via, ...(e.completed ? { completedMs: millis(e.completed) } : {}) };
  }
  return { day: parsed.data.day, entries, completed: { ...parsed.data.completed } };
}

function docFromLog(log: QuestLog): QuestLogLangDoc {
  const entries: QuestLogLangDoc["entries"] = {};
  for (const [id, e] of Object.entries(log.entries)) {
    entries[id] = {
      status: e.status,
      progress: e.progress,
      accepted: Timestamp.fromMillis(e.acceptedMs),
      via: e.via,
      ...(e.completedMs !== undefined ? { completed: Timestamp.fromMillis(e.completedMs) } : {}),
    };
  }
  return QuestLogLangSchema.parse({ day: log.day, entries, completed: log.completed });
}

/** The stored log of one language from the whole document (a broken one reads as none). */
function langLog(data: unknown, lang: string): QuestLog | null {
  const raw = (data as { langs?: Record<string, unknown> } | undefined)?.langs?.[lang];
  return raw === undefined ? null : logFromDoc(raw);
}

export function createFirestoreQuestStore(db: Firestore): QuestStore {
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
  /** Writes one language's log, keeping the others (a missing or broken document is replaced). */
  const writeLog = (tx: Transaction, uid: string, exists: boolean, valid: boolean, lang: string, log: QuestLog) => {
    const ref = db.doc(FirestorePaths.questLog(uid));
    const doc = docFromLog(log);
    if (exists && valid) tx.update(ref, new FieldPath("langs", lang), doc);
    else tx.set(ref, QuestLogDocSchema.parse({ langs: { [lang]: doc } }));
  };
  const isValid = (snap: { exists: boolean; data(): unknown }) => snap.exists && QuestLogDocSchema.safeParse(snap.data()).success;

  return {
    async log(uid, lang) {
      const snap = await db.doc(FirestorePaths.questLog(uid)).get();
      return snap.exists ? langLog(snap.data(), lang) : null;
    },
    async level(uid, lang) {
      const snap = await db.doc(FirestorePaths.lang(uid, lang)).get();
      if (!snap.exists) return null;
      const parsed = LangProgressSchema.safeParse(snap.data());
      return parsed.success ? parsed.data.level : null;
    },
    async update(uid, lang, fn) {
      const ref = db.doc(FirestorePaths.questLog(uid));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const out = fn(snap.exists ? langLog(snap.data(), lang) : null);
        if (out.log) writeLog(tx, uid, snap.exists, isValid(snap), lang, out.log);
        return out.result;
      });
    },
    async settle(uid, lang, quest, npcId, clock) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      const logRef = db.doc(FirestorePaths.questLog(uid));
      return db.runTransaction(async (tx): Promise<QuestSettlement | null> => {
        const [langSnap, invSnap, logSnap] = await Promise.all([tx.get(langRef), tx.get(inventory(uid)), tx.get(logRef)]);
        if (!langSnap.exists) return null;
        const progress = LangProgressSchema.parse(langSnap.data());
        const giver = quest.template.giver;
        const log = (logSnap.exists ? langLog(logSnap.data(), lang) : null) ?? { day: clock.day, entries: {}, completed: {} };
        const result = settleQuest(log, quest, npcId, { coins: progress.coins, hearts: progress.hearts[giver] ?? 0, slots: readSlots(invSnap.docs) }, clock);
        if (!result.ok) return result;
        tx.update(langRef, { coins: result.coins, [`hearts.${giver}`]: result.hearts });
        writeSlots(tx, uid, result.slots, result.changed);
        writeLog(tx, uid, logSnap.exists, isValid(logSnap), lang, result.log);
        return result;
      });
    },
  };
}

export function firestoreQuestStoreFor(app: App): QuestStore {
  return createFirestoreQuestStore(getFirestore(app));
}

export interface MemoryQuestStore extends QuestStore {
  /** Keyed by `${uid}/${lang}`. */
  readonly logs: Map<string, QuestLog>;
}

/** In memory, over the in-memory NPC store's players (coins, hearts and the bag are shared with trades, catches, finds and dishes). */
export function createMemoryQuestStore(npcStore: MemoryNpcStore, initial: Record<string, QuestLog> = {}): MemoryQuestStore {
  const logs = new Map(Object.entries(initial));
  return {
    logs,
    async log(uid, lang) {
      const log = logs.get(`${uid}/${lang}`);
      return log ? structuredClone(log) : null;
    },
    async level(uid, lang) {
      return npcStore.players.get(`${uid}/${lang}`)?.level ?? null;
    },
    async update(uid, lang, fn) {
      const key = `${uid}/${lang}`;
      const stored = logs.get(key);
      const out = fn(stored ? structuredClone(stored) : null);
      if (out.log) logs.set(key, structuredClone(out.log));
      return out.result;
    },
    async settle(uid, lang, quest, npcId, clock) {
      const p = npcStore.players.get(`${uid}/${lang}`);
      if (!p) return null;
      const key = `${uid}/${lang}`;
      const giver = quest.template.giver;
      const log = logs.get(key) ?? { day: clock.day, entries: {}, completed: {} };
      const result = settleQuest(structuredClone(log), quest, npcId, { coins: p.coins, hearts: p.hearts[giver] ?? 0, slots: p.slots }, clock);
      if (!result.ok) return result;
      p.coins = result.coins;
      p.hearts[giver] = result.hearts;
      p.slots = result.slots;
      logs.set(key, structuredClone(result.log));
      return { ...result, slots: result.slots.map((s) => ({ ...s })) };
    },
  };
}
