import {
  acceptQuest,
  applyQuestEvent,
  expireQuests,
  type NpcId,
  type NpcQuestBrief,
  type Quest,
  type QuestClock,
  type QuestEvent,
  type QuestLog,
  questBriefs,
  questById,
  questLogFor,
  type QuestRefusal,
  type QuestResultMessage,
  questsCompletableWith,
  questsOfDay,
  questsOfferedBy,
  type QuestStateMessage,
  type QuestVia,
  questViews,
  worldClockAt,
} from "@hellovalley/shared";
import type { QuestStore } from "./questStore";

/**
 * Daily requests and quests on the server (build plan M30, GDD §5.5, architecture §6.1). The
 * requests of a player on an in-game day are a pure function of (uid, language, day) (shared
 * quests/board.ts), so a restart recomputes them; the store keeps only the quest log.
 *
 * - The board's requests are taken at the Town Hall notice board (`quest:accept`, the room checks
 *   the server's walker is there) or from the Mayor (`giveQuest`); a villager's favour only from
 *   that villager (`giveQuest`).
 * - Progress comes only from the server's own events: catches, dishes and pick-ups. Automatic
 *   requests (catch, cook, find) complete as soon as they reach their quantity.
 * - Deliveries and fetches are handed over in a conversation with the right villager, through the
 *   "Hand over" card (`quest:handover`) or the model's `completeQuest`; either way the server
 *   checks the NPC, the bag and the deadline, and pays the reward and takes the items in one
 *   transaction (`settleQuest`). What the model says never completes anything by itself.
 */

export interface QuestServiceOptions {
  /** The clock (tests advance a fake one). */
  now?: () => number;
}

/** What the NPC dialogue service asks of quests (build plan M30). */
export interface DialogueQuests {
  /** The briefs for `npc:context`, and the ids the turn may give (giveQuest) or complete (completeQuest). */
  context(uid: string, lang: string, npcId: NpcId, inventory: Readonly<Partial<Record<string, number>>>): Promise<{ briefs: NpcQuestBrief[]; offered: string[]; completable: string[] }>;
  accept(uid: string, lang: string, questId: string, npcId: NpcId | null): Promise<QuestResultMessage>;
  complete(uid: string, lang: string, questId: string, npcId: NpcId | null, via: QuestVia): Promise<QuestResultMessage>;
}

/** Shortest gap between two `quest:accept` of one player (my number). */
export const QUEST_ACCEPT_COOLDOWN_MS = 300;

export class QuestService implements DialogueQuests {
  readonly now: () => number;
  private readonly lastAccept = new Map<string, number>();
  private cached: { key: string; quests: Quest[] } | null = null;

  constructor(
    private readonly store: QuestStore,
    options: QuestServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  clock(): QuestClock {
    const nowMs = this.now();
    const c = worldClockAt(nowMs);
    return { day: c.day, minutes: c.minutes, nowMs };
  }

  /** Today's board and favours of a player (the last one is kept: the same player asks several times in a row). */
  quests(uid: string, lang: string, day: number): Quest[] {
    const key = `${uid}|${lang}|${day}`;
    if (this.cached?.key !== key) this.cached = { key, quests: questsOfDay(uid, lang, day) };
    return this.cached.quests;
  }

  private async currentLog(uid: string, lang: string, clock: QuestClock): Promise<QuestLog> {
    return expireQuests(questLogFor(await this.store.log(uid, lang), clock.day), this.quests(uid, lang, clock.day), clock);
  }

  /** `quests:state`: today's board and the log, or null when the store failed. */
  async state(uid: string, lang: string): Promise<QuestStateMessage | null> {
    const clock = this.clock();
    try {
      const [log, level] = await Promise.all([this.currentLog(uid, lang, clock), this.store.level(uid, lang)]);
      return { day: clock.day, level, ...questViews(this.quests(uid, lang, clock.day), log, clock) };
    } catch (err) {
      console.error(`[quests] reading the log of ${uid}/${lang} failed:`, err);
      return null;
    }
  }

  /** `quest:accept` at the board (`npcId` null; the room checked the walker is there) or `giveQuest` (the NPC). */
  async accept(uid: string, lang: string, questId: string, npcId: NpcId | null): Promise<QuestResultMessage> {
    const refuse = (reason: QuestRefusal): QuestResultMessage => ({ questId, action: "accept", ok: false, reason });
    const clock = this.clock();
    if (npcId === null) {
      if (clock.nowMs - (this.lastAccept.get(uid) ?? Number.NEGATIVE_INFINITY) < QUEST_ACCEPT_COOLDOWN_MS) return refuse("rate");
      this.lastAccept.set(uid, clock.nowMs);
    }
    const quest = questById(uid, lang, questId);
    try {
      const result = await this.store.update<ReturnType<typeof acceptQuest>>(uid, lang, (stored) => {
        const log = expireQuests(questLogFor(stored, clock.day), this.quests(uid, lang, clock.day), clock);
        const verdict = acceptQuest(log, quest, npcId, clock);
        return verdict.ok ? { log: verdict.log, result: verdict } : { log: null, result: verdict };
      });
      if (!result.ok) return refuse(result.reason);
      return { questId, action: "accept", ok: true, via: npcId === null ? "board" : "npc" };
    } catch (err) {
      console.error(`[quests] accepting ${questId} for ${uid}/${lang} failed:`, err);
      return refuse("unavailable");
    }
  }

  /** Completes a request (hand-over, `completeQuest` or automatic); the store re-checks everything in the transaction. */
  async complete(uid: string, lang: string, questId: string, npcId: NpcId | null, via: QuestVia): Promise<QuestResultMessage> {
    const refuse = (reason: QuestRefusal): QuestResultMessage => ({ questId, action: "complete", ok: false, reason });
    const clock = this.clock();
    const quest = questById(uid, lang, questId);
    if (!quest) return refuse("unknown_quest");
    try {
      const result = await this.store.settle(uid, lang, quest, npcId, clock);
      if (!result) return refuse("unavailable");
      if (!result.ok) return refuse(result.reason);
      return { questId, action: "complete", ok: true, via, reward: quest.reward, coins: result.coins, hearts: result.hearts };
    } catch (err) {
      console.error(`[quests] completing ${questId} for ${uid}/${lang} failed:`, err);
      return refuse("unavailable");
    }
  }

  /**
   * A server event (a catch, a dish, a pick-up) moves the open automatic requests; the ones that
   * reach their quantity are completed at once. Returns the completions (empty when nothing moved)
   * and whether anything moved (the room then sends the new state).
   */
  async onEvent(uid: string, lang: string, event: QuestEvent): Promise<{ moved: boolean; completed: QuestResultMessage[] }> {
    const clock = this.clock();
    let ready: string[];
    let moved = false;
    try {
      ready = await this.store.update(uid, lang, (stored) => {
        if (!stored || stored.day !== clock.day) return { log: null, result: [] as string[] };
        const r = applyQuestEvent(stored, this.quests(uid, lang, clock.day), event, clock.day);
        moved = r.moved.length > 0;
        return { log: moved ? r.log : null, result: r.ready };
      });
    } catch (err) {
      console.error(`[quests] progress for ${uid}/${lang} failed:`, err);
      return { moved: false, completed: [] };
    }
    const completed: QuestResultMessage[] = [];
    for (const questId of ready) completed.push(await this.complete(uid, lang, questId, null, "auto"));
    return { moved, completed };
  }

  /** DialogueQuests: what this NPC's turn may do with quests, and the briefs for the prompt. */
  async context(uid: string, lang: string, npcId: NpcId, inventory: Readonly<Partial<Record<string, number>>>): Promise<{ briefs: NpcQuestBrief[]; offered: string[]; completable: string[] }> {
    const clock = this.clock();
    const quests = this.quests(uid, lang, clock.day);
    const log = await this.currentLog(uid, lang, clock);
    return {
      briefs: questBriefs(npcId, quests, log, inventory, clock),
      offered: questsOfferedBy(npcId, quests, log, clock),
      completable: questsCompletableWith(npcId, quests, log, inventory, clock),
    };
  }

  /** The player left: forget their pacing. */
  forget(uid: string): void {
    this.lastAccept.delete(uid);
  }
}
