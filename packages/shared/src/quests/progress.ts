import { clockToMinutes, MINUTES_PER_DAY } from "../data/world";
import { getForage } from "../data/forage";
import { isFishId } from "../data/fish";
import type { ItemId } from "../data/items";
import type { NpcId } from "../data/npcs";
import type { RecipeId } from "../data/recipes";
import { clampHearts } from "../npc/friendship";
import { applyItemDeltas, type ItemDelta, itemCounts, type SlotEntry, TOTAL_SLOTS } from "../npc/inventory";
import { SUNRISE_MINUTES } from "../world/clock";
import { BOARD_NPC, type Quest, type QuestSource } from "./board";
import { isHandIn, type QuestKind, questNpcs, questSummaryEn, turnInNpc } from "./templates";

/**
 * The quest log and its rules (build plan M30, architecture §6.1: "completeQuest only if the
 * server-side conditions hold (inventory, location, time)"). Pure: the server's quest store keeps
 * one log per player and target language (`users/{uid}/collections/quests`), feeds it the server's
 * own events (catches, dishes, pick-ups) and settles completions in one transaction.
 *
 * A log only holds the current in-game day: at the next day the board changes and whatever was
 * left open expires (the counts of completed requests survive).
 */

/** Quests accepted at once (board + favours; my number, the whole day's set fits). */
export const MAX_ACTIVE_QUESTS = 5;

export type QuestStatus = "active" | "completed" | "expired";

export interface QuestEntry {
  status: QuestStatus;
  /** How many of the target the server has seen since accepting (automatic kinds). */
  progress: number;
  acceptedMs: number;
  /** Who handed it out: the board, the Mayor or a villager (`giveQuest`). */
  via: QuestSource;
  completedMs?: number;
}

export interface QuestLog {
  /** The in-game day the entries belong to. */
  day: number;
  /** questId → entry (accepted quests of `day` only). */
  entries: Record<string, QuestEntry>;
  /** Completed requests of every day, by kind. */
  completed: Partial<Record<QuestKind, number>>;
}

export const emptyQuestLog = (day: number): QuestLog => ({ day, entries: {}, completed: {} });

/** The log as of `day`: entries of an earlier day are dropped (they expired), the counts stay. */
export function questLogFor(log: QuestLog | null, day: number): QuestLog {
  if (!log) return emptyQuestLog(day);
  if (log.day === day) return log;
  return { day, entries: {}, completed: { ...log.completed } };
}

/** In-game minutes since the day began (the day starts at sunrise, world/clock.ts). */
export function minutesIntoDay(clockMinutes: number): number {
  return (((clockMinutes - SUNRISE_MINUTES) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Whether a quest's deadline has passed at this in-game clock time (only deliveries have one; the rest last the day). */
export function deadlinePassed(quest: Quest, clockMinutes: number): boolean {
  const target = quest.template.target;
  if (target.kind !== "deliver") return false;
  const by = clockToMinutes(target.by);
  return by !== undefined && minutesIntoDay(clockMinutes) >= minutesIntoDay(by);
}

/** Where the world is when a rule is checked. */
export interface QuestClock {
  day: number;
  /** In-game clock minutes (0–1440). */
  minutes: number;
  nowMs: number;
}

/** Marks open entries whose delivery deadline passed as expired. */
export function expireQuests(log: QuestLog, quests: readonly Quest[], clock: QuestClock): QuestLog {
  const current = questLogFor(log, clock.day);
  let entries = current.entries;
  for (const q of quests) {
    const e = entries[q.questId];
    if (e?.status === "active" && deadlinePassed(q, clock.minutes)) entries = { ...entries, [q.questId]: { ...e, status: "expired" } };
  }
  return entries === current.entries ? current : { ...current, entries };
}

export type QuestAcceptRefusal = "unknown_quest" | "already_accepted" | "too_late" | "too_many" | "wrong_npc";

/**
 * Accepting a request: it must be one of today's (board or favour), not taken yet, not past its
 * deadline, and the log must have room. `npcId` is who handed it out: on the board (null), the
 * Mayor (any board request), or the villager whose favour it is.
 */
export function acceptQuest(log: QuestLog | null, quest: Quest | null, npcId: NpcId | null, clock: QuestClock): { ok: true; log: QuestLog } | { ok: false; reason: QuestAcceptRefusal } {
  const current = questLogFor(log, clock.day);
  if (!quest || quest.day !== clock.day) return { ok: false, reason: "unknown_quest" };
  if (npcId === null ? quest.source !== "board" : quest.source === "board" ? npcId !== BOARD_NPC : quest.template.giver !== npcId) return { ok: false, reason: "wrong_npc" };
  if (current.entries[quest.questId]) return { ok: false, reason: "already_accepted" };
  if (deadlinePassed(quest, clock.minutes)) return { ok: false, reason: "too_late" };
  if (Object.values(current.entries).filter((e) => e.status === "active").length >= MAX_ACTIVE_QUESTS) return { ok: false, reason: "too_many" };
  const via: QuestSource = npcId === null || quest.source === "board" ? "board" : "npc";
  return { ok: true, log: { ...current, entries: { ...current.entries, [quest.questId]: { status: "active", progress: 0, acceptedMs: clock.nowMs, via } } } };
}

/** Something the server saw the player do (its own records, never the client's word). */
export type QuestEvent = { type: "caught"; fishId: string } | { type: "cooked"; recipeId: RecipeId } | { type: "found"; itemId: ItemId };

/** How much an event moves a quest along (0: it does not count). */
export function eventCount(quest: Quest, event: QuestEvent): number {
  const t = quest.template.target;
  switch (t.kind) {
    case "catch":
      return event.type === "caught" && isFishId(event.fishId) && (t.fishId === undefined || t.fishId === event.fishId) ? 1 : 0;
    case "cook":
      return event.type === "cooked" && event.recipeId === t.recipeId ? 1 : 0;
    case "find":
      return event.type === "found" && getForage(event.itemId)?.kind === t.forageKind ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * An event moves the open automatic quests it counts for; the ones that reach their quantity are
 * `ready` (the caller completes them in the reward transaction).
 */
export function applyQuestEvent(log: QuestLog, quests: readonly Quest[], event: QuestEvent, day: number): { log: QuestLog; ready: string[]; moved: string[] } {
  const current = questLogFor(log, day);
  const entries = { ...current.entries };
  const ready: string[] = [];
  const moved: string[] = [];
  for (const q of quests) {
    const e = entries[q.questId];
    if (e?.status !== "active" || isHandIn(q.template)) continue;
    const n = eventCount(q, event);
    if (n === 0) continue;
    const progress = Math.min(q.template.target.qty, e.progress + n);
    entries[q.questId] = { ...e, progress };
    moved.push(q.questId);
    if (progress >= q.template.target.qty) ready.push(q.questId);
  }
  return { log: moved.length ? { ...current, entries } : current, ready, moved };
}

export type QuestTurnInRefusal = "not_active" | "wrong_npc" | "missing_items" | "too_late" | "not_ready";

/**
 * Whether a quest can be completed now: active, before its deadline, and either an automatic
 * quest that reached its quantity, or a hand-in at the right NPC with the items in the bag.
 * `npcId` is who the player is talking to (null outside a conversation).
 */
export function canCompleteQuest(
  quest: Quest,
  entry: QuestEntry | undefined,
  ctx: { npcId: NpcId | null; inventory: Readonly<Partial<Record<string, number>>>; minutes: number },
): { ok: true } | { ok: false; reason: QuestTurnInRefusal } {
  if (entry?.status !== "active") return { ok: false, reason: "not_active" };
  if (deadlinePassed(quest, ctx.minutes)) return { ok: false, reason: "too_late" };
  const t = quest.template;
  if (!isHandIn(t)) return entry.progress >= t.target.qty ? { ok: true } : { ok: false, reason: "not_ready" };
  if (ctx.npcId !== turnInNpc(t)) return { ok: false, reason: "wrong_npc" };
  const target = t.target as { itemId: ItemId; qty: number };
  if ((ctx.inventory[target.itemId] ?? 0) < target.qty) return { ok: false, reason: "missing_items" };
  return { ok: true };
}

/** The items a completion moves: the hand-in leaves the bag, a bonus item comes in. */
export function completionItems(quest: Quest): ItemDelta[] {
  const t = quest.template.target;
  const items: ItemDelta[] = [];
  if (t.kind === "deliver" || t.kind === "fetch") items.push({ itemId: t.itemId, qty: -t.qty });
  if (quest.reward.itemId) items.push({ itemId: quest.reward.itemId, qty: 1 });
  return items;
}

export type QuestSettleRefusal = QuestTurnInRefusal | "unknown_quest" | "inventory_full";

/** What the player has, read inside the reward transaction. */
export interface QuestWallet {
  coins: number;
  /** Hearts with the requester. */
  hearts: number;
  slots: readonly SlotEntry[];
}

export type QuestSettlement =
  | { ok: true; log: QuestLog; coins: number; hearts: number; heartsDelta: number; slots: SlotEntry[]; changed: number[] }
  | { ok: false; reason: QuestSettleRefusal };

/**
 * Completes a quest: re-checks the conditions against the records read in the transaction, then
 * pays the reward (coins, hearts with the requester, the bonus item) and takes the hand-in items.
 * All or nothing.
 */
export function settleQuest(log: QuestLog, quest: Quest | null, npcId: NpcId | null, wallet: QuestWallet, clock: QuestClock): QuestSettlement {
  const current = questLogFor(log, clock.day);
  if (!quest || quest.day !== clock.day) return { ok: false, reason: "unknown_quest" };
  const entry = current.entries[quest.questId];
  const check = canCompleteQuest(quest, entry, { npcId, inventory: itemCounts(wallet.slots), minutes: clock.minutes });
  if (!check.ok) return check;
  const items = applyItemDeltas(wallet.slots, completionItems(quest), TOTAL_SLOTS);
  if (!items.ok) return { ok: false, reason: items.reason === "inventory_full" ? "inventory_full" : "missing_items" };
  const hearts = clampHearts(wallet.hearts + quest.reward.hearts);
  const kind = quest.template.target.kind;
  const next: QuestLog = {
    ...current,
    entries: { ...current.entries, [quest.questId]: { ...entry!, status: "completed", progress: quest.template.target.qty, completedMs: clock.nowMs } },
    completed: { ...current.completed, [kind]: (current.completed[kind] ?? 0) + 1 },
  };
  return { ok: true, log: next, coins: wallet.coins + quest.reward.coins, hearts, heartsDelta: hearts - wallet.hearts, slots: items.slots, changed: items.changed };
}

// ---------------------------------------------------------------------------------------------
// What NPC conversations see (architecture §6.1: giveQuest / completeQuest)

/** Quests `npcId` may hand out now (`giveQuest`): their own favour, or for the Mayor the board. */
export function questsOfferedBy(npcId: NpcId, quests: readonly Quest[], log: QuestLog, clock: QuestClock): string[] {
  const current = questLogFor(log, clock.day);
  return quests
    .filter((q) => q.day === clock.day && !current.entries[q.questId] && !deadlinePassed(q, clock.minutes))
    .filter((q) => (q.source === "board" ? npcId === BOARD_NPC : q.template.giver === npcId))
    .map((q) => q.questId);
}

/** Hand-in quests the player could complete with `npcId` right now (`completeQuest`). */
export function questsCompletableWith(npcId: NpcId, quests: readonly Quest[], log: QuestLog, inventory: Readonly<Partial<Record<string, number>>>, clock: QuestClock): string[] {
  const current = questLogFor(log, clock.day);
  return quests
    .filter((q) => isHandIn(q.template) && canCompleteQuest(q, current.entries[q.questId], { npcId, inventory, minutes: clock.minutes }).ok)
    .map((q) => q.questId);
}

/** One quest as the NPC turn prompt sees it (`{{quests_json}}`, English facts, server data). */
export interface NpcQuestBrief {
  questId: string;
  /** `offered`: the NPC may hand it out (giveQuest); `active`: the player is on it; `done`: completed today. */
  status: "offered" | "active" | "done";
  /** The NPC's part: they asked, they receive the delivery, or (the Mayor) they posted it. */
  role: "asked" | "receives" | "posted";
  summary: string;
  /** Hand-in quest the player can complete with this NPC now (completeQuest). */
  canComplete?: boolean;
}

/** The quests involving `npcId` today, for `npc:context.quests`. */
export function questBriefs(npcId: NpcId, quests: readonly Quest[], log: QuestLog, inventory: Readonly<Partial<Record<string, number>>>, clock: QuestClock): NpcQuestBrief[] {
  const current = questLogFor(log, clock.day);
  const offered = new Set(questsOfferedBy(npcId, quests, current, clock));
  const completable = new Set(questsCompletableWith(npcId, quests, current, inventory, clock));
  const out: NpcQuestBrief[] = [];
  for (const q of quests) {
    const e = current.entries[q.questId];
    const involved = questNpcs(q.template).includes(npcId);
    const posted = npcId === BOARD_NPC && q.source === "board";
    if (!involved && !(posted && (offered.has(q.questId) || e))) continue;
    const status = offered.has(q.questId) ? "offered" : e?.status === "active" ? "active" : e?.status === "completed" ? "done" : null;
    if (!status) continue;
    const role = q.template.giver === npcId ? "asked" : involved ? "receives" : "posted";
    out.push({ questId: q.questId, status, role, summary: questSummaryEn(q.template), ...(completable.has(q.questId) ? { canComplete: true } : {}) });
  }
  return out;
}

