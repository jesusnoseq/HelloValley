import { getItem, type ItemId, isItemId } from "../data/items";
import { getNpc, type NpcId } from "../data/npcs";
import { MAX_HEARTS } from "../firestore/schemas";

/**
 * Friendship rules (GDD §8.2, build plan M24): 0–10 hearts per NPC and target language. Hearts
 * rise through conversation quality (`friendshipDelta`, capped in npc/actions.ts), gifts (each NPC
 * has liked and disliked items), completed requests and daily greetings, and decay slightly after
 * 7 days without contact. Everything here is pure: the game server's store reads the bond, calls
 * these, and writes the result in one transaction (architecture §6.2).
 *
 * The numbers are mine (the GDD gives none); see pending.md §M24:
 *
 * | Event | Hearts | Cap |
 * |---|---|---|
 * | Daily greeting (first conversation with the NPC in an in-game day) | +¼ | once per NPC per in-game day |
 * | Gift the NPC likes | +1 | one gift per NPC per in-game day |
 * | Neutral gift | +¼ | (same) |
 * | Gift the NPC dislikes | −½ | (same) |
 * | Completed request (`completeQuest`, server conditions) | +1 | per quest |
 * | No contact for 7 real days | −½ per full week | never below 1 heart (or the current value, if lower) |
 * | Conversation quality (`friendshipDelta`) | ±½ per point | +1 point per conversation, +2 per NPC per in-game day |
 *
 * Decay counts real days, not in-game days: an in-game day is 40 minutes (GDD §4.3), so "7 days
 * without contact" in game days would be under five hours.
 */

export const DAILY_GREETING_HEARTS = 0.25;
export const GIFT_HEARTS = { liked: 1, neutral: 0.25, disliked: -0.5 } as const;
export const QUEST_COMPLETION_HEARTS = 1;
/** Gifts an NPC accepts from one player per in-game day. */
export const GIFTS_RECEIVED_PER_DAY = 1;
export const REAL_DAY_MS = 24 * 60 * 60 * 1000;
/** Days without contact before hearts start to decay. */
export const DECAY_GRACE_DAYS = 7;
export const DECAY_HEARTS_PER_WEEK = 0.5;
/** Decay never takes hearts below this (hearts already lower stay where they are). */
export const DECAY_FLOOR_HEARTS = 1;

/** Item categories a player cannot give: tools, and lost items (they are *returned*: `npc:return`, forage/lost.ts). */
export const UNGIFTABLE_CATEGORIES = ["tool", "lost"] as const;

export type GiftReaction = keyof typeof GIFT_HEARTS;

/** Hearts kept within 0..10, on a quarter-heart grid (so float sums never drift). */
export function clampHearts(hearts: number): number {
  if (!Number.isFinite(hearts)) return 0;
  return Math.min(MAX_HEARTS, Math.max(0, Math.round(hearts * 4) / 4));
}

export function isGiftable(itemId: string): itemId is ItemId {
  if (!isItemId(itemId)) return false;
  const category = getItem(itemId)?.category;
  return category !== undefined && !(UNGIFTABLE_CATEGORIES as readonly string[]).includes(category);
}

/** How the NPC feels about a gift (its liked and disliked lists in data/npcs.ts). */
export function giftReaction(npcId: NpcId, itemId: ItemId): GiftReaction {
  const npc = getNpc(npcId);
  if (npc.likedItems.includes(itemId)) return "liked";
  if (npc.dislikedItems.includes(itemId)) return "disliked";
  return "neutral";
}

/**
 * The hearts change after `daysAway` real days without contact: none in the first 7 days, then
 * −½ for each full week, never below DECAY_FLOOR_HEARTS (≤ 0).
 */
export function heartsDecay(hearts: number, lastSeenMs: number | null, nowMs: number): number {
  if (lastSeenMs === null || !Number.isFinite(lastSeenMs) || nowMs <= lastSeenMs) return 0;
  const weeks = Math.floor((nowMs - lastSeenMs) / (DECAY_GRACE_DAYS * REAL_DAY_MS));
  if (weeks <= 0) return 0;
  const h = clampHearts(hearts);
  const floor = Math.min(h, DECAY_FLOOR_HEARTS);
  return Math.max(floor, h - weeks * DECAY_HEARTS_PER_WEEK) - h;
}

/** What the server keeps per player × NPC × language beyond the memory text (`npcMemory/{npcId}`). */
export interface NpcBond {
  hearts: number;
  /** Real time of the last conversation (ms), or null before the first meeting. */
  lastSeenMs: number | null;
  /** In-game day of the last daily greeting. */
  greetedDay: number | null;
  /** In-game day of the last gift the NPC accepted. */
  giftedDay: number | null;
}

export const newBond = (hearts = 0): NpcBond => ({ hearts: clampHearts(hearts), lastSeenMs: null, greetedDay: null, giftedDay: null });

export interface ContactResult {
  bond: NpcBond;
  /** Hearts from the daily greeting (0 when already greeted today). */
  greeting: number;
  /** Hearts lost to decay since the last contact (≤ 0). */
  decay: number;
}

/**
 * A conversation starts (`npc:start`): first the decay since the last contact, then the daily
 * greeting, and the contact time moves to now (so a gap decays once).
 */
export function applyContact(bond: NpcBond, nowMs: number, today: number): ContactResult {
  const start = clampHearts(bond.hearts);
  const decay = heartsDecay(start, bond.lastSeenMs, nowMs);
  const decayed = clampHearts(start + decay);
  const hearts = bond.greetedDay === today ? decayed : clampHearts(decayed + DAILY_GREETING_HEARTS);
  return {
    bond: { ...bond, hearts, lastSeenMs: Math.max(nowMs, bond.lastSeenMs ?? nowMs), greetedDay: today },
    greeting: hearts - decayed,
    decay: decayed - start,
  };
}

export type GiftRefusal = "not_giftable" | "gift_cap";

export type GiftOutcome = { ok: true; bond: NpcBond; reaction: GiftReaction; delta: number } | { ok: false; reason: GiftRefusal };

/**
 * The player gives the NPC one item (the caller checks and removes it from the inventory in the
 * same transaction). One gift per NPC per in-game day; liked +1, neutral +¼, disliked −½.
 */
export function applyGift(bond: NpcBond, npcId: NpcId, itemId: string, today: number): GiftOutcome {
  if (!isGiftable(itemId)) return { ok: false, reason: "not_giftable" };
  if (bond.giftedDay === today) return { ok: false, reason: "gift_cap" };
  const reaction = giftReaction(npcId, itemId);
  const hearts = clampHearts(bond.hearts + GIFT_HEARTS[reaction]);
  return { ok: true, bond: { ...bond, hearts, giftedDay: today }, reaction, delta: hearts - clampHearts(bond.hearts) };
}

/** Hearts for completed requests (the server's own conditions held, TODO(M30)). */
export function questCompletionHearts(completed: number): number {
  return Math.max(0, Math.trunc(completed)) * QUEST_COMPLETION_HEARTS;
}
