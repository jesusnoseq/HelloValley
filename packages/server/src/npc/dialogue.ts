import { randomUUID } from "node:crypto";
import {
  type ApprovedAction,
  conversationPerformance,
  type ConversationLedger,
  type ConversationTelemetry,
  createTokenBucket,
  type DailyLedger,
  effectiveLevelInfo,
  elderSecretFlag,
  emptyConversationLedger,
  emptyDailyLedger,
  getNpc,
  type InventoryEntry,
  itemCounts,
  type ItemId,
  type LostItemHint,
  lostItemFlags,
  type NpcAction,
  type NpcAppliedMessage,
  npcBuys,
  npcBuyUnitPrice,
  npcSellUnitPrice,
  type NpcContextMessage,
  type NpcGiftedMessage,
  type NpcGiftMessage,
  type NpcMemoryMessage,
  type NpcRememberedMessage,
  type NpcId,
  type NpcPriceEntry,
  type NpcRefusal,
  type NpcTradeMessage,
  type PendingTrade,
  type QuestResultMessage,
  type RateLimit,
  recipesTaughtBy,
  schedulePointAt,
  settleTrade,
  SHOPS,
  type SlotEntry,
  takeToken,
  type TokenBucket,
  type TradeProposal,
  validateNpcActions,
  WORLD_WEATHER_SEED,
  weatherAt,
  worldClockAt,
  worldDayAt,
} from "@hellovalley/shared";
import type { DialogueFood } from "../food/food";
import type { DialogueQuests } from "../quests/quests";
import type { ContactOutcome, NpcPlayerRecord, NpcStore } from "./npcStore";

/**
 * The game server's half of an NPC conversation (build plan M21 mapped onto architecture §5.3,
 * §6.1, §9). The server never calls a model: the client runs the `npc-turn` template through
 * Firebase AI Logic and sends the model's actions back as an untrusted proposal. This service
 *
 * - answers `npc:start` with the context (level, memory, learning words, stock and prices, world)
 *   and a server-issued turn id;
 * - checks each `npc:reply` against that turn id, the rate and turn limits, and the shared action
 *   rules (`validateNpcActions`), applies the immediate effects (hearts, gifts) in one store
 *   transaction and keeps trades pending until the player confirms them (`npc:confirm`);
 * - recomputes every price itself;
 * - (build plan M24) applies the contact rules at `npc:start` (decay after a week away, the daily
 *   greeting), takes gifts (`npc:gift`), and stores the client's compaction after `npc:end`
 *   (`npc:memory`: summary, facts, lastSeen, and the level estimate), all through the shared
 *   pure rules in npc/friendship.ts, npc/memory.ts and npc/levelAdaptation.ts.
 *
 * - (build plan M29) stores the recipes an NPC teaches (`teachRecipe`) in the recipe book and adds
 *   what the player ate today (the Doctor after three cakes) and the coffee's extra hint to the
 *   context, through the food service.
 * - (build plan M30) puts today's requests involving the NPC into the context, and settles an
 *   accepted `giveQuest` (the request goes into the quest log) or `completeQuest` (the quest
 *   service re-checks the NPC, the bag and the deadline and pays the reward in its own
 *   transaction; a refusal there rejects the action).
 *
 * Calling the model without a turn id costs the player's AI Logic quota but has no game effect
 * (architecture §9). Limits and ledgers live in memory: there is one server process (§3.1), so a
 * restart resets them, which only ever gives a player a fresh daily allowance.
 */

/** Turns in one conversation (my number). */
export const NPC_TURNS_PER_CONVERSATION = 30;
/** Turns per player per UTC day across all NPCs (my number; AI Logic per-user RPM is the hard cap). */
export const NPC_TURNS_PER_DAY = 300;
/** Reply cadence: a burst of 3, then one every 3 s (a model turn takes longer than that anyway). */
export const NPC_REPLY_RATE: RateLimit = { burst: 3, perSecond: 1 / 3 };
/** Conversation starts: a burst of 4, then one every 10 s. */
export const NPC_START_RATE: RateLimit = { burst: 4, perSecond: 1 / 10 };
/** A conversation with no message for this long is forgotten (pending trades go with it). */
export const NPC_CONVERSATION_IDLE_MS = 10 * 60_000;
/**
 * After `npc:end` the client compacts the conversation (on-device, or the AI Logic cloud fallback)
 * and sends `npc:memory`; it is accepted for this long (build plan M24).
 */
export const NPC_MEMORY_WINDOW_MS = 3 * 60_000;
/** Ended conversations kept per player waiting for their memory (walking from NPC to NPC). */
export const NPC_CLOSED_KEPT = 3;

interface Conversation {
  id: string;
  npcId: NpcId;
  lang: string;
  nativeLang: string;
  /** The turn id the next reply must carry; null while one is being applied or after the end. */
  turnId: string | null;
  turnsUsed: number;
  ledger: ConversationLedger;
  trades: Map<string, TradeProposal>;
  ended: boolean;
  lastActivity: number;
}

interface PlayerState {
  conversation: Conversation | null;
  /** Ended conversations whose `npc:memory` may still come (newest last). */
  closed: { conversation: Conversation; endedAt: number }[];
  replyBucket: TokenBucket;
  startBucket: TokenBucket;
  /** UTC day (`YYYY-MM-DD`) and turns used on it. */
  day: string;
  turnsToday: number;
}

export interface StartRequest {
  uid: string;
  npcId: NpcId;
  lang: string;
  nativeLang: string;
  /** The Gossip's hint context (build plan M28): the lost items lying in the player's shard today. */
  lostHints?: LostItemHint[];
  /** Build plan M31: the shard's village news for the Gossip (rumours) and the Elder (legends). */
  news?: string[];
}

export type Refused = { ok: false; reason: NpcRefusal };

const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Without a food service (older tests): no recipes are known, and taught ones are not kept. */
const noFood: DialogueFood = {
  knownRecipes: () => Promise.resolve([]),
  learnRecipes: () => Promise.resolve([]),
  flags: () => [],
  extraHints: () => 0,
};
/** Without a quest service (older tests): no requests, so giveQuest and completeQuest are always rejected. */
const noQuests: DialogueQuests = {
  context: () => Promise.resolve({ briefs: [], offered: [], completable: [] }),
  accept: (_uid, _lang, questId) => Promise.resolve({ questId, action: "accept", ok: false, reason: "unavailable" }),
  complete: (_uid, _lang, questId) => Promise.resolve({ questId, action: "complete", ok: false, reason: "unavailable" }),
};
const entries = (slots: readonly SlotEntry[]): InventoryEntry[] =>
  Object.entries(itemCounts(slots)).map(([itemId, qty]) => ({ itemId: itemId as ItemId, qty: qty ?? 0 }));

export class NpcDialogueService {
  private readonly players = new Map<string, PlayerState>();
  /** `${uid}|${lang}|${npcId}|${worldDay}` → what was given today (architecture §6.1 per-day caps). */
  private readonly daily = new Map<string, DailyLedger>();

  constructor(
    private readonly store: NpcStore,
    /** Recipes, eating flags and the coffee hint (build plan M29). */
    private readonly food: DialogueFood = noFood,
    /** Daily requests and favours (build plan M30). */
    private readonly quests: DialogueQuests = noQuests,
  ) {}

  /** Today's requests for the context and the turn's checks; a failing quest store leaves them out rather than the conversation. */
  private async questContext(uid: string, lang: string, npcId: NpcId, slots: readonly SlotEntry[]) {
    try {
      return await this.quests.context(uid, lang, npcId, itemCounts(slots));
    } catch (err) {
      console.error(`[npc] reading the quests of ${uid}/${lang} failed:`, err);
      return { briefs: [], offered: [], completable: [] };
    }
  }

  private player(uid: string, now: number): PlayerState {
    let p = this.players.get(uid);
    if (!p) {
      p = { conversation: null, closed: [], replyBucket: createTokenBucket(NPC_REPLY_RATE, now), startBucket: createTokenBucket(NPC_START_RATE, now), day: utcDay(now), turnsToday: 0 };
      this.players.set(uid, p);
    }
    if (p.day !== utcDay(now)) {
      p.day = utcDay(now);
      p.turnsToday = 0;
    }
    if (p.conversation && now - p.conversation.lastActivity > NPC_CONVERSATION_IDLE_MS) this.close(p, now);
    p.closed = p.closed.filter((c) => now - c.endedAt <= NPC_MEMORY_WINDOW_MS);
    return p;
  }

  /** The active conversation ends; it waits for its memory (only one that had a turn is worth remembering). */
  private close(p: PlayerState, now: number): void {
    const c = p.conversation;
    p.conversation = null;
    if (!c) return;
    c.turnId = null;
    c.trades.clear();
    if (c.turnsUsed > 0) p.closed = [...p.closed, { conversation: c, endedAt: now }].slice(-NPC_CLOSED_KEPT);
  }

  private dailyKey(uid: string, c: Pick<Conversation, "lang" | "npcId">, now: number): string {
    return `${uid}|${c.lang}|${c.npcId}|${worldClockAt(now).day}`;
  }

  private turnsLeft(p: PlayerState, c: Conversation): number {
    return Math.max(0, Math.min(NPC_TURNS_PER_CONVERSATION - c.turnsUsed, NPC_TURNS_PER_DAY - p.turnsToday));
  }

  private stockFor(npcId: NpcId, ledger: ConversationLedger): NpcPriceEntry[] {
    return (SHOPS[npcId]?.sells ?? []).map((itemId) => ({ itemId, price: npcSellUnitPrice(npcId, itemId, ledger) }));
  }

  private buysFor(npcId: NpcId, slots: readonly SlotEntry[]): NpcPriceEntry[] {
    return entries(slots)
      .filter((e) => npcBuys(npcId, e.itemId))
      .map((e) => ({ itemId: e.itemId, price: npcBuyUnitPrice(npcId, e.itemId) }));
  }

  /** `npc:start`: a new conversation (any previous one ends), with its context and first turn id. */
  async start(req: StartRequest, now = Date.now()): Promise<{ ok: true; context: NpcContextMessage } | Refused> {
    const p = this.player(req.uid, now);
    if (!takeToken(p.startBucket, NPC_START_RATE, now)) return { ok: false, reason: "rate" };
    if (p.turnsToday >= NPC_TURNS_PER_DAY) return { ok: false, reason: "daily_limit" };
    let record: NpcPlayerRecord | null;
    let contact: ContactOutcome | null;
    let known: string[] = [];
    try {
      // The contact first (decay since the last visit, the daily greeting, lastSeen), then the records.
      contact = await this.store.contact(req.uid, req.lang, req.npcId, now, worldDayAt(now));
      record = contact ? await this.store.load(req.uid, req.lang, req.npcId) : null;
      if (record) known = await this.food.knownRecipes(req.uid);
    } catch (err) {
      console.error(`[npc] loading ${req.uid}/${req.lang} for ${req.npcId} failed:`, err);
      return { ok: false, reason: "unavailable" };
    }
    if (!record || !contact) return { ok: false, reason: "unavailable" };
    const quests = await this.questContext(req.uid, req.lang, req.npcId, record.slots);
    // A conversation still open (another NPC) ends here and waits for its memory.
    this.close(p, now);
    const conversation: Conversation = {
      id: randomUUID(),
      npcId: req.npcId,
      lang: req.lang,
      nativeLang: req.nativeLang,
      turnId: randomUUID(),
      turnsUsed: 0,
      ledger: emptyConversationLedger(),
      trades: new Map(),
      ended: false,
      lastActivity: now,
    };
    p.conversation = conversation;
    const npc = getNpc(req.npcId);
    const clock = worldClockAt(now);
    const eff = effectiveLevelInfo(record.level, req.npcId);
    const context: NpcContextMessage = {
      conversationId: conversation.id,
      turnId: conversation.turnId!,
      npcId: req.npcId,
      lang: req.lang,
      nativeLang: req.nativeLang,
      playerLevel: record.level,
      effectiveLevel: eff.level,
      simplified: eff.simplified,
      hearts: record.hearts,
      contact: { greeting: contact.greeting, decay: contact.decay },
      giftedToday: contact.giftedToday,
      lastSeen: contact.previousLastSeen,
      coins: record.coins,
      memory: record.memory,
      learningWords: record.learningWords,
      stock: this.stockFor(req.npcId, conversation.ledger),
      buys: this.buysFor(req.npcId, record.slots),
      inventory: entries(record.slots),
      recipes: recipesTaughtBy(req.npcId).map((r) => ({ recipeId: r.id, heartsRequired: r.heartsRequired, known: known.includes(r.id) })),
      // Build plan M30: today's requests involving this NPC (offered favours, active, done).
      quests: quests.briefs,
      // Build plan M28: lost items the player carries; M29: what the player ate today.
      // Build plan M31: the Elder tells of his secret fishing spot once he trusts the player.
      flags: [...lostItemFlags(req.npcId, entries(record.slots)), ...this.food.flags(req.uid, req.npcId), ...(req.npcId === "elder" ? [elderSecretFlag(record.hearts)].filter((f): f is string => f !== null) : [])],
      // Build plan M29: the coffee buff's extra suggested-reply hint.
      extraHints: this.food.extraHints(req.uid),
      hints: req.npcId === "gossip" ? (req.lostHints ?? []) : [],
      news: req.npcId === "gossip" || req.npcId === "elder" ? (req.news ?? []) : [],
      world: { timeOfDay: clock.timeOfDay, weather: weatherAt(now, WORLD_WEATHER_SEED).weather, location: schedulePointAt(npc, clock.minutes)?.place ?? npc.building, minutes: Math.floor(clock.minutes) },
      turnsLeft: this.turnsLeft(p, conversation),
    };
    return { ok: true, context };
  }

  /** `npc:reply`: validates the model's proposed actions for the turn the server issued. */
  async reply(
    uid: string,
    msg: { conversationId: string; turnId: string; actions: NpcAction[] },
    now = Date.now(),
  ): Promise<{ ok: true; applied: NpcAppliedMessage; quests: QuestResultMessage[] } | Refused> {
    const p = this.player(uid, now);
    const c = p.conversation;
    if (!c || c.id !== msg.conversationId) return { ok: false, reason: "no_conversation" };
    if (c.turnId === null || c.turnId !== msg.turnId) return { ok: false, reason: "unknown_turn" };
    if (!takeToken(p.replyBucket, NPC_REPLY_RATE, now)) return { ok: false, reason: "rate" };
    // The turn id is used up before anything async, so a replayed reply cannot apply twice.
    c.turnId = null;
    c.lastActivity = now;
    const restore = (reason: NpcRefusal): Refused => {
      if (p.conversation === c) c.turnId = msg.turnId;
      return { ok: false, reason };
    };

    let record: NpcPlayerRecord | null;
    let known: string[];
    try {
      record = await this.store.load(uid, c.lang, c.npcId);
      known = record ? await this.food.knownRecipes(uid) : [];
    } catch (err) {
      console.error(`[npc] loading ${uid}/${c.lang} failed:`, err);
      return restore("unavailable");
    }
    if (!record) return restore("unavailable");
    const quests = await this.questContext(uid, c.lang, c.npcId, record.slots);
    const dailyKey = this.dailyKey(uid, c, now);
    const verdict = validateNpcActions(msg.actions, {
      npcId: c.npcId,
      hearts: record.hearts,
      inventory: itemCounts(record.slots),
      knownRecipes: known,
      questsOffered: quests.offered,
      questsCompletable: quests.completable,
      conversation: c.ledger,
      daily: this.daily.get(dailyKey) ?? emptyDailyLedger(),
    });
    let accepted: ApprovedAction[] = verdict.accepted;
    const rejected = [...verdict.rejected];
    let hearts = record.hearts;
    let slots = record.slots;
    let daily = verdict.daily;
    const { effects } = verdict;
    // Build plan M29: taught recipes go into the recipe book first (a failure refuses the whole turn).
    if (effects.recipes.length > 0) {
      try {
        await this.food.learnRecipes(uid, effects.recipes, c.npcId, c.lang);
      } catch (err) {
        console.error(`[npc] storing a taught recipe for ${uid} failed:`, err);
        return restore("unavailable");
      }
    }
    if (effects.hearts !== 0 || effects.items.length > 0) {
      try {
        let result = await this.store.apply(uid, c.lang, { npcId: c.npcId, coins: 0, hearts: effects.hearts, items: effects.items });
        if (!result.ok && effects.items.length > 0) {
          // No room for the gift: the rest of the turn still counts.
          accepted = accepted.filter((a) => a.type !== "give");
          for (const _ of effects.items) rejected.push({ type: "give", reason: "inventory_full" });
          daily = { ...daily, gifts: daily.gifts - effects.items.length };
          result = await this.store.apply(uid, c.lang, { npcId: c.npcId, coins: 0, hearts: effects.hearts, items: [] });
        }
        if (result.ok) {
          hearts = result.hearts;
          slots = result.slots;
        }
      } catch (err) {
        console.error(`[npc] applying a turn for ${uid} failed:`, err);
        return restore("unavailable");
      }
    }
    // Build plan M30: a given request goes into the log; a completed one is settled by the quest
    // service (reward and hand-in items in its own transaction). A refusal there rejects the action.
    const questResults: QuestResultMessage[] = [];
    for (const questId of effects.questsGiven) questResults.push(await this.quests.accept(uid, c.lang, questId, c.npcId));
    for (const questId of effects.questsCompleted) questResults.push(await this.quests.complete(uid, c.lang, questId, c.npcId, "npc"));
    for (const r of questResults) {
      if (r.ok) continue;
      const type = r.action === "accept" ? "giveQuest" : "completeQuest";
      accepted = accepted.filter((a) => !(a.type === type && a.questId === r.questId));
      rejected.push({ type, reason: r.action === "accept" ? "unknown_quest" : "conditions_not_met" });
    }
    const settled = questResults.filter((r) => r.ok && r.action === "complete");
    if (settled.length > 0) {
      // The reward moved coins, hearts and items: answer with the records as they are now.
      try {
        const fresh = await this.store.load(uid, c.lang, c.npcId);
        if (fresh) {
          hearts = fresh.hearts;
          slots = fresh.slots;
        }
      } catch (err) {
        console.error(`[npc] reloading ${uid}/${c.lang} after a quest failed:`, err);
      }
    }
    c.ledger = verdict.conversation;
    this.daily.set(dailyKey, daily);
    c.turnsUsed++;
    p.turnsToday++;
    const trades: PendingTrade[] = verdict.trades.map((t) => {
      const tradeId = randomUUID();
      c.trades.set(tradeId, t);
      return { tradeId, ...t };
    });
    if (verdict.ended) c.ended = true;
    const more = !c.ended && this.turnsLeft(p, c) > 0;
    c.turnId = more ? randomUUID() : null;
    const applied: NpcAppliedMessage = {
      conversationId: c.id,
      turnId: msg.turnId,
      accepted,
      rejected,
      trades,
      nextTurnId: c.turnId,
      ended: c.ended,
      hearts,
      stock: this.stockFor(c.npcId, c.ledger),
      inventory: entries(slots),
    };
    return { ok: true, applied, quests: questResults };
  }

  /** `npc:confirm`: the player accepts or declines a pending trade; an accepted one is settled in one transaction. */
  async confirm(uid: string, msg: { conversationId: string; tradeId: string; accept: boolean }, now = Date.now()): Promise<NpcTradeMessage | Refused> {
    const p = this.player(uid, now);
    const c = p.conversation;
    if (!c || c.id !== msg.conversationId) return { ok: false, reason: "no_conversation" };
    c.lastActivity = now;
    const trade = c.trades.get(msg.tradeId);
    const answer = (ok: boolean, coins: number, slots: readonly SlotEntry[], reason?: NpcTradeMessage["reason"]): NpcTradeMessage => ({
      tradeId: msg.tradeId,
      ok,
      ...(reason ? { reason } : {}),
      coins,
      inventory: entries(slots),
    });
    // Load first: every answer carries the current coins and inventory.
    let record: NpcPlayerRecord | null;
    try {
      record = await this.store.load(uid, c.lang, c.npcId);
    } catch (err) {
      console.error(`[npc] loading ${uid}/${c.lang} failed:`, err);
      return { ok: false, reason: "unavailable" };
    }
    if (!record) return { ok: false, reason: "unavailable" };
    if (!trade) return answer(false, record.coins, record.slots, "unknown_trade");
    c.trades.delete(msg.tradeId);
    if (!msg.accept) return answer(false, record.coins, record.slots, "declined");
    const settled = settleTrade(trade, { coins: record.coins, held: itemCounts(record.slots)[trade.itemId] ?? 0 });
    if (!settled.ok) return answer(false, record.coins, record.slots, settled.reason);
    try {
      const result = await this.store.apply(uid, c.lang, { npcId: c.npcId, coins: settled.coins, hearts: 0, items: [{ itemId: trade.itemId, qty: settled.items }] });
      if (!result.ok) return answer(false, record.coins, record.slots, result.reason);
      return answer(true, result.coins, result.slots);
    } catch (err) {
      console.error(`[npc] settling a trade for ${uid} failed:`, err);
      c.trades.set(msg.tradeId, trade);
      return { ok: false, reason: "unavailable" };
    }
  }

  /**
   * `npc:end` (or the player walked away or left): the conversation and its pending trades are
   * dropped, and it waits NPC_MEMORY_WINDOW_MS for its `npc:memory`.
   */
  end(uid: string, conversationId?: string, now = Date.now()): void {
    const p = this.players.get(uid);
    if (p?.conversation && (conversationId === undefined || p.conversation.id === conversationId)) this.close(p, now);
  }

  /**
   * `npc:memory` (build plan M24, architecture §5.3, §6.1): the client's compaction of a conversation
   * that ended. Accepted once per conversation, only for one that had at least one turn, and only
   * within NPC_MEMORY_WINDOW_MS. The store sanitises and merges the memory; the level estimate uses
   * the turns the server counted, so a forged message moves the level no faster than ½ step per
   * in-game day.
   */
  async remember(uid: string, msg: MemoryInput, now = Date.now()): Promise<{ ok: true; remembered: NpcRememberedMessage } | Refused> {
    const p = this.player(uid, now);
    if (p.conversation?.id === msg.conversationId) this.close(p, now);
    const at = p.closed.findIndex((e) => e.conversation.id === msg.conversationId);
    if (at < 0) return { ok: false, reason: "no_conversation" };
    const [entry] = p.closed.splice(at, 1);
    const c = entry!.conversation;
    const performance = conversationPerformance(msg.signals, msg.telemetry, c.turnsUsed);
    try {
      const result = await this.store.remember(uid, c.lang, c.npcId, {
        memory: { summary: msg.summary, facts: msg.facts },
        performance,
        playerTurns: c.turnsUsed,
        nowMs: now,
        today: worldDayAt(now),
      });
      if (!result) return { ok: false, reason: "unavailable" };
      return { ok: true, remembered: { conversationId: c.id, npcId: c.npcId, level: result.level, levelChange: result.change } };
    } catch (err) {
      console.error(`[npc] storing the memory of ${uid}/${c.lang}/${c.npcId} failed:`, err);
      // The client may send it again while the window is open.
      p.closed.push(entry!);
      return { ok: false, reason: "unavailable" };
    }
  }

  /**
   * `npc:return` (build plan M28): the open conversation a lost item is handed back in, paced
   * like gifts. The forage service applies the return itself.
   */
  conversationFor(uid: string, conversationId: string, now = Date.now()): { ok: true; npcId: NpcId; lang: string } | Refused {
    const p = this.player(uid, now);
    const c = p.conversation;
    if (!c || c.id !== conversationId) return { ok: false, reason: "no_conversation" };
    if (!takeToken(p.replyBucket, NPC_REPLY_RATE, now)) return { ok: false, reason: "rate" };
    c.lastActivity = now;
    return { ok: true, npcId: c.npcId, lang: c.lang };
  }

  /** `npc:gift` (build plan M24): the player gives the NPC one item; liked, neutral or disliked (shared `applyGift`). */
  async gift(uid: string, msg: NpcGiftMessage, now = Date.now()): Promise<{ ok: true; gifted: NpcGiftedMessage } | Refused> {
    const p = this.player(uid, now);
    const c = p.conversation;
    if (!c || c.id !== msg.conversationId) return { ok: false, reason: "no_conversation" };
    if (!takeToken(p.replyBucket, NPC_REPLY_RATE, now)) return { ok: false, reason: "rate" };
    c.lastActivity = now;
    try {
      const r = await this.store.gift(uid, c.lang, c.npcId, msg.itemId, worldDayAt(now));
      const gifted: NpcGiftedMessage = {
        conversationId: c.id,
        itemId: msg.itemId,
        ok: r.ok,
        ...(r.ok ? { reaction: r.reaction } : { reason: r.reason }),
        delta: r.ok ? r.delta : 0,
        hearts: r.hearts,
        inventory: entries(r.slots),
      };
      return { ok: true, gifted };
    } catch (err) {
      console.error(`[npc] a gift from ${uid} failed:`, err);
      return { ok: false, reason: "unavailable" };
    }
  }
}

/** `npc:memory` as the shared schema parsed it. */
export type MemoryInput = Omit<NpcMemoryMessage, "telemetry"> & { telemetry: ConversationTelemetry };
