import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  adaptLevel,
  applyContact,
  applyGift,
  applyItemDeltas,
  clampHearts,
  Collection,
  FirestorePaths,
  type GiftReaction,
  InventorySlotSchema,
  type ItemDelta,
  type ItemId,
  LangProgressSchema,
  LEARNING_WORDS_MAX,
  LEARNING_WORDS_SCAN,
  type MoveSlotRefusal,
  moveSlot,
  type Level,
  levelToStep,
  MAX_HEARTS,
  mergeNpcMemory,
  newBond,
  type NpcBond,
  type NpcGiftFailure,
  NotebookEntrySchema,
  type NotebookItem,
  type NpcId,
  NpcMemorySchema,
  type NpcMemoryText,
  pickLearningWords,
  type SlotEntry,
  type TimestampLike,
  TOTAL_SLOTS,
  type TradeFailure,
} from "@hellovalley/shared";

/**
 * What the NPC dialogue service reads and writes (build plans M21 and M24, architecture §6.2):
 * the player's level, level estimate, coins and hearts (`users/{uid}/langs/{lang}`), the NPC's
 * memory of them (`…/npcMemory/{npcId}`: summary, facts, lastSeen, and the in-game days of the
 * last greeting and gift), the notebook's "learning" words (build plan M25) and the inventory (`users/{uid}/inventory/{slot}`).
 * Every write goes through the Admin SDK in one transaction per accepted change; the rules
 * themselves are the pure shared functions (npc/friendship.ts, npc/memory.ts, npc/levelAdaptation.ts).
 */
export interface NpcPlayerRecord {
  level: Level;
  coins: number;
  /** Hearts with the NPC asked about. */
  hearts: number;
  /** null when nothing is remembered yet (no summary and no facts). */
  memory: NpcMemoryText | null;
  learningWords: string[];
  slots: SlotEntry[];
  bond: NpcBond;
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

/** What `npc:start` did to the bond. */
export interface ContactOutcome {
  hearts: number;
  greeting: number;
  decay: number;
  /** The previous contact time (ms), before this one. */
  previousLastSeen: number | null;
  giftedToday: boolean;
}

export type GiftResult =
  | { ok: true; reaction: GiftReaction; delta: number; hearts: number; slots: SlotEntry[] }
  | { ok: false; reason: NpcGiftFailure; hearts: number; slots: SlotEntry[] };

export interface MemoryUpdate {
  /** The compaction (sanitised and merged by the store with `mergeNpcMemory`). */
  memory: NpcMemoryText;
  /** `conversationPerformance`, or null when the conversation was too short to rate. */
  performance: number | null;
  /** Player turns the server counted. */
  playerTurns: number;
  nowMs: number;
  /** In-game day index. */
  today: number;
}

export interface RememberOutcome {
  memory: NpcMemoryText;
  level: Level;
  levelEstimate: number;
  change: -1 | 0 | 1;
}

export interface NpcStore {
  /** The player's records for a conversation, or null when `langs/{lang}` does not exist. */
  load(uid: string, lang: string, npcId: NpcId): Promise<NpcPlayerRecord | null>;
  /** Applies a change atomically, re-checking coins and inventory inside the transaction. */
  apply(uid: string, lang: string, change: PlayerChange): Promise<ApplyResult>;
  /** A conversation starts: decay since the last contact, the daily greeting, and lastSeen = now. Null: no `langs/{lang}`. */
  contact(uid: string, lang: string, npcId: NpcId, nowMs: number, today: number): Promise<ContactOutcome | null>;
  /** The player gives the NPC one item: the gift rule and the item removal in one transaction. */
  gift(uid: string, lang: string, npcId: NpcId, itemId: ItemId, today: number): Promise<GiftResult>;
  /** A conversation was compacted: the merged memory, lastSeen and the level update. Null: no `langs/{lang}`. */
  remember(uid: string, lang: string, npcId: NpcId, update: MemoryUpdate): Promise<RememberOutcome | null>;
  /** The player's coins (in `langs/{lang}`) and inventory slots (build plan M26). Null: no `langs/{lang}`. */
  wallet(uid: string, lang: string): Promise<PlayerWallet | null>;
  /** Moves a stack between two slots (shared `moveSlot`) in one transaction. Null: no `langs/{lang}`. */
  moveSlot(uid: string, lang: string, from: number, to: number): Promise<MoveOutcome | null>;
}

/** Coins and slots, as the inventory UI shows them. */
export interface PlayerWallet {
  coins: number;
  slots: SlotEntry[];
}

export type MoveOutcome = ({ ok: true } & PlayerWallet) | ({ ok: false; reason: MoveSlotRefusal } & PlayerWallet);

/**
 * Notebook words passed to NPCs (build plan M25: up to 5): `pickLearningWords` over the newest
 * LEARNING_WORDS_SCAN entries (cards in learning first, weakest recall first, then new words).
 */
export const LEARNING_WORDS_LIMIT = LEARNING_WORDS_MAX;

const clampHeartsRange = (h: number) => Math.min(MAX_HEARTS, Math.max(0, h));

function computeChange(coins: number, hearts: number, slots: SlotEntry[], change: PlayerChange) {
  if (coins + change.coins < 0) return { ok: false as const, reason: "insufficient_coins" as const };
  const items = applyItemDeltas(slots, change.items, TOTAL_SLOTS);
  if (!items.ok) return items;
  return { ok: true as const, coins: coins + change.coins, hearts: clampHeartsRange(hearts + change.hearts), slots: items.slots, changed: items.changed };
}

function computeGift(bond: NpcBond, npcId: NpcId, itemId: ItemId, today: number, slots: SlotEntry[]) {
  const outcome = applyGift(bond, npcId, itemId, today);
  if (!outcome.ok) return { ok: false as const, reason: outcome.reason };
  const items = applyItemDeltas(slots, [{ itemId, qty: -1 }], TOTAL_SLOTS);
  if (!items.ok) return { ok: false as const, reason: "not_owned" as const };
  return { ok: true as const, outcome, items };
}

const emptyMemory = (m: NpcMemoryText | null) => !m || (m.summary.trim() === "" && m.facts.length === 0);
const millis = (t: TimestampLike) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);

export function createFirestoreNpcStore(db: Firestore): NpcStore {
  const inventory = (uid: string) => db.collection(`${FirestorePaths.user(uid)}/${Collection.Inventory}`);
  const readSlots = (docs: { id: string; data(): unknown }[]): SlotEntry[] =>
    docs.flatMap((d) => {
      const slot = Number(d.id);
      const parsed = InventorySlotSchema.safeParse(d.data());
      // A slot that does not parse is skipped (and never written back), not fatal.
      return Number.isInteger(slot) && slot >= 0 && slot < TOTAL_SLOTS && parsed.success ? [{ slot, ...parsed.data }] : [];
    });
  /** The memory document, or null when it is missing or does not parse (then it is rewritten whole). */
  const readMemory = (snap: { exists: boolean; data(): unknown }) => {
    if (!snap.exists) return null;
    const parsed = NpcMemorySchema.safeParse(snap.data());
    return parsed.success ? parsed.data : null;
  };
  const bondOf = (hearts: number, m: ReturnType<typeof readMemory>): NpcBond => ({
    hearts: clampHearts(hearts),
    lastSeenMs: m ? millis(m.lastSeen) : null,
    greetedDay: m?.greetedDay ?? null,
    giftedDay: m?.giftedDay ?? null,
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
  /** The full memory document for a bond (`set`, so a missing or broken one is replaced). */
  const memoryDoc = (text: NpcMemoryText, bond: NpcBond, nowMs: number) =>
    NpcMemorySchema.parse({
      summary: text.summary,
      facts: text.facts,
      lastSeen: Timestamp.fromMillis(bond.lastSeenMs ?? nowMs),
      ...(bond.greetedDay !== null ? { greetedDay: bond.greetedDay } : {}),
      ...(bond.giftedDay !== null ? { giftedDay: bond.giftedDay } : {}),
    });

  return {
    async load(uid, lang, npcId) {
      const [langSnap, memorySnap, notebookSnap, inventorySnap] = await Promise.all([
        db.doc(FirestorePaths.lang(uid, lang)).get(),
        db.doc(FirestorePaths.npcMemory(uid, lang, npcId)).get(),
        db.collection(FirestorePaths.notebook(uid, lang)).orderBy("createdAt", "desc").limit(LEARNING_WORDS_SCAN).get(),
        inventory(uid).get(),
      ]);
      if (!langSnap.exists) return null;
      const progress = LangProgressSchema.parse(langSnap.data());
      const memory = readMemory(memorySnap);
      const items = notebookSnap.docs.flatMap((d): NotebookItem[] => {
        const parsed = NotebookEntrySchema.safeParse(d.data());
        if (!parsed.success) return [];
        const { createdAt, updatedAt: _updated, ...entry } = parsed.data;
        return [{ id: d.id, entry, createdMs: millis(createdAt) }];
      });
      const learningWords = pickLearningWords(items, Date.now(), LEARNING_WORDS_LIMIT);
      const text = memory ? { summary: memory.summary, facts: memory.facts } : null;
      const hearts = progress.hearts[npcId] ?? 0;
      return {
        level: progress.level,
        coins: progress.coins,
        hearts,
        memory: emptyMemory(text) ? null : text,
        learningWords,
        slots: readSlots(inventorySnap.docs),
        bond: bondOf(hearts, memory),
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
        writeSlots(tx, uid, result.slots, result.changed);
        return { ok: true, coins: result.coins, hearts: result.hearts, slots: result.slots };
      });
    },
    async contact(uid, lang, npcId, nowMs, today) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      const memoryRef = db.doc(FirestorePaths.npcMemory(uid, lang, npcId));
      return db.runTransaction(async (tx) => {
        const [langSnap, memorySnap] = await Promise.all([tx.get(langRef), tx.get(memoryRef)]);
        if (!langSnap.exists) return null;
        const progress = LangProgressSchema.parse(langSnap.data());
        const memory = readMemory(memorySnap);
        const bond = bondOf(progress.hearts[npcId] ?? 0, memory);
        const result = applyContact(bond, nowMs, today);
        if (result.bond.hearts !== bond.hearts) tx.update(langRef, { [`hearts.${npcId}`]: result.bond.hearts });
        tx.set(memoryRef, memoryDoc(memory ?? { summary: "", facts: [] }, result.bond, nowMs));
        return { hearts: result.bond.hearts, greeting: result.greeting, decay: result.decay, previousLastSeen: bond.lastSeenMs, giftedToday: bond.giftedDay === today };
      });
    },
    async gift(uid, lang, npcId, itemId, today) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      const memoryRef = db.doc(FirestorePaths.npcMemory(uid, lang, npcId));
      return db.runTransaction(async (tx): Promise<GiftResult> => {
        const [langSnap, memorySnap, invSnap] = await Promise.all([tx.get(langRef), tx.get(memoryRef), tx.get(inventory(uid))]);
        if (!langSnap.exists) throw new Error(`users/${uid}/langs/${lang} does not exist`);
        const progress = LangProgressSchema.parse(langSnap.data());
        const memory = readMemory(memorySnap);
        const bond = bondOf(progress.hearts[npcId] ?? 0, memory);
        const slots = readSlots(invSnap.docs);
        const result = computeGift(bond, npcId, itemId, today, slots);
        if (!result.ok) return { ok: false, reason: result.reason, hearts: bond.hearts, slots };
        const next = result.outcome.bond;
        tx.update(langRef, { [`hearts.${npcId}`]: next.hearts });
        tx.set(memoryRef, memoryDoc(memory ?? { summary: "", facts: [] }, next, Date.now()));
        writeSlots(tx, uid, result.items.slots, result.items.changed);
        return { ok: true, reaction: result.outcome.reaction, delta: result.outcome.delta, hearts: next.hearts, slots: result.items.slots };
      });
    },
    async remember(uid, lang, npcId, update) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      const memoryRef = db.doc(FirestorePaths.npcMemory(uid, lang, npcId));
      return db.runTransaction(async (tx) => {
        const [langSnap, memorySnap] = await Promise.all([tx.get(langRef), tx.get(memoryRef)]);
        if (!langSnap.exists) return null;
        const progress = LangProgressSchema.parse(langSnap.data());
        const memory = readMemory(memorySnap);
        const text = mergeNpcMemory(memory ? { summary: memory.summary, facts: memory.facts } : null, update.memory);
        const bond = { ...bondOf(progress.hearts[npcId] ?? 0, memory), lastSeenMs: update.nowMs };
        tx.set(memoryRef, memoryDoc(text, bond, update.nowMs));
        const level = adaptLevel(
          { level: progress.level, levelEstimate: progress.levelEstimate, levelChangedDay: progress.levelChangedDay ?? null },
          update.performance,
          update.playerTurns,
          update.today,
        );
        if (update.performance !== null) {
          tx.update(langRef, {
            level: level.state.level,
            levelEstimate: level.state.levelEstimate,
            ...(level.state.levelChangedDay !== null ? { levelChangedDay: level.state.levelChangedDay } : {}),
          });
        }
        return { memory: text, level: level.state.level, levelEstimate: level.state.levelEstimate, change: level.change };
      });
    },
    async wallet(uid, lang) {
      const [langSnap, invSnap] = await Promise.all([db.doc(FirestorePaths.lang(uid, lang)).get(), inventory(uid).get()]);
      if (!langSnap.exists) return null;
      return { coins: LangProgressSchema.parse(langSnap.data()).coins, slots: readSlots(invSnap.docs) };
    },
    async moveSlot(uid, lang, from, to) {
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      return db.runTransaction(async (tx): Promise<MoveOutcome | null> => {
        const [langSnap, invSnap] = await Promise.all([tx.get(langRef), tx.get(inventory(uid))]);
        if (!langSnap.exists) return null;
        const coins = LangProgressSchema.parse(langSnap.data()).coins;
        const slots = readSlots(invSnap.docs);
        const result = moveSlot(slots, from, to, TOTAL_SLOTS);
        if (!result.ok) return { ok: false, reason: result.reason, coins, slots };
        writeSlots(tx, uid, result.slots, result.changed);
        return { ok: true, coins, slots: result.slots };
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
  /** Defaults to the level's step. */
  levelEstimate?: number;
  levelChangedDay?: number;
  coins: number;
  hearts: Partial<Record<NpcId, number>>;
  memory?: Partial<Record<NpcId, NpcMemoryText>>;
  /** lastSeen and the greeting and gift days per NPC (the rest of `npcMemory/{npcId}`). */
  bonds?: Partial<Record<NpcId, Omit<NpcBond, "hearts">>>;
  /** Fixed words (older tests); `notebook` wins when both are given. */
  learningWords?: string[];
  /** Notebook entries, picked from like the Firestore store does. */
  notebook?: NotebookItem[];
  slots: SlotEntry[];
}

/** Keyed by `${uid}/${lang}`. */
export function createMemoryNpcStore(initial: Record<string, MemoryPlayer> = {}): MemoryNpcStore {
  const players = new Map(Object.entries(initial));
  const bondOf = (p: MemoryPlayer, npcId: NpcId): NpcBond => ({ ...newBond(), ...p.bonds?.[npcId], hearts: clampHearts(p.hearts[npcId] ?? 0) });
  const setBond = (p: MemoryPlayer, npcId: NpcId, bond: NpcBond) => {
    const { hearts, ...rest } = bond;
    p.hearts[npcId] = hearts;
    p.bonds = { ...p.bonds, [npcId]: rest };
  };
  return {
    players,
    async load(uid, lang, npcId) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) return null;
      const memory = p.memory?.[npcId] ?? null;
      return {
        level: p.level,
        coins: p.coins,
        hearts: p.hearts[npcId] ?? 0,
        memory: emptyMemory(memory) ? null : { summary: memory!.summary, facts: [...memory!.facts] },
        learningWords: p.notebook ? pickLearningWords(p.notebook, Date.now(), LEARNING_WORDS_LIMIT) : (p.learningWords ?? []).slice(0, LEARNING_WORDS_LIMIT),
        slots: p.slots.map((s) => ({ ...s })),
        bond: bondOf(p, npcId),
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
    async contact(uid, lang, npcId, nowMs, today) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) return null;
      const bond = bondOf(p, npcId);
      const result = applyContact(bond, nowMs, today);
      setBond(p, npcId, result.bond);
      return { hearts: result.bond.hearts, greeting: result.greeting, decay: result.decay, previousLastSeen: bond.lastSeenMs, giftedToday: bond.giftedDay === today };
    },
    async gift(uid, lang, npcId, itemId, today) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) throw new Error(`no player ${uid}/${lang}`);
      const bond = bondOf(p, npcId);
      const result = computeGift(bond, npcId, itemId, today, p.slots);
      if (!result.ok) return { ok: false, reason: result.reason, hearts: bond.hearts, slots: p.slots.map((s) => ({ ...s })) };
      setBond(p, npcId, result.outcome.bond);
      p.slots = result.items.slots;
      return { ok: true, reaction: result.outcome.reaction, delta: result.outcome.delta, hearts: result.outcome.bond.hearts, slots: p.slots.map((s) => ({ ...s })) };
    },
    async remember(uid, lang, npcId, update) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) return null;
      const text = mergeNpcMemory(p.memory?.[npcId] ?? null, update.memory);
      p.memory = { ...p.memory, [npcId]: text };
      setBond(p, npcId, { ...bondOf(p, npcId), lastSeenMs: update.nowMs });
      const level = adaptLevel(
        { level: p.level, levelEstimate: p.levelEstimate ?? levelToStep(p.level), levelChangedDay: p.levelChangedDay ?? null },
        update.performance,
        update.playerTurns,
        update.today,
      );
      p.level = level.state.level;
      p.levelEstimate = level.state.levelEstimate;
      if (level.state.levelChangedDay !== null) p.levelChangedDay = level.state.levelChangedDay;
      return { memory: text, level: level.state.level, levelEstimate: level.state.levelEstimate, change: level.change };
    },
    async wallet(uid, lang) {
      const p = players.get(`${uid}/${lang}`);
      return p ? { coins: p.coins, slots: p.slots.map((s) => ({ ...s })) } : null;
    },
    async moveSlot(uid, lang, from, to) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) return null;
      const result = moveSlot(p.slots, from, to, TOTAL_SLOTS);
      if (!result.ok) return { ok: false, reason: result.reason, coins: p.coins, slots: p.slots.map((s) => ({ ...s })) };
      p.slots = result.slots;
      return { ok: true, coins: p.coins, slots: p.slots.map((s) => ({ ...s })) };
    },
  };
}
