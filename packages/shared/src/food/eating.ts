import { getItem, isConsumable, isItemId, type ItemId, SHOPS } from "../data/items";
import type { NpcId } from "../data/npcs";
import { isHotbarSlot, type SlotEntry } from "../npc/inventory";

/**
 * Eating and drinking from the hotbar (GDD §5.4, build plan M29). The player holds a food or drink
 * in a hotbar slot and eats it (`food:eat {slot}`); the server checks the slot itself (a hotbar
 * slot holding something edible), takes one from that stack, adds the buff (food/buffs.ts) and
 * remembers what was eaten today, which NPCs may react to (the Doctor after three cakes).
 */

/** Shortest gap between two bites (my number). */
export const EAT_COOLDOWN_MS = 1500;
// EATING_ACTIVITY_MS (how long the synced "eating" activity lasts) is in protocol/messages.ts (no zod, for the client entry chunk).

export type EatRefusal = "not_hotbar" | "empty_slot" | "not_food" | "cooldown" | "busy" | "unavailable";

export type EatVerdict = { ok: true; itemId: ItemId; slots: SlotEntry[]; changed: number[] } | { ok: false; reason: EatRefusal };

/** Takes one bite from the stack in hotbar `slot` (the pure part of the server's check). */
export function judgeEat(slots: readonly SlotEntry[], slot: number): EatVerdict {
  if (!isHotbarSlot(slot)) return { ok: false, reason: "not_hotbar" };
  const entry = slots.find((s) => s.slot === slot);
  if (!entry || entry.qty <= 0) return { ok: false, reason: "empty_slot" };
  if (!isItemId(entry.itemId) || !isConsumable(entry.itemId)) return { ok: false, reason: "not_food" };
  const next = slots.flatMap((s) => (s.slot !== slot ? [{ ...s }] : s.qty > 1 ? [{ ...s, qty: s.qty - 1 }] : []));
  return { ok: true, itemId: entry.itemId, slots: next, changed: [slot] };
}

/** What a player ate on one in-game day. */
export interface EatLog {
  day: number;
  counts: Partial<Record<ItemId, number>>;
}

/** Counts a bite on in-game day `today` (a new day starts a new log). */
export function recordEaten(log: EatLog | null, itemId: ItemId, today: number): EatLog {
  const counts = log && log.day === today ? { ...log.counts } : {};
  counts[itemId] = (counts[itemId] ?? 0) + 1;
  return { day: today, counts };
}

/** How many of `itemId` the player ate on `today`. */
export function eatenToday(log: EatLog | null, itemId: ItemId, today: number): number {
  return log && log.day === today ? (log.counts[itemId] ?? 0) : 0;
}

/** GDD §5.4: "the Doctor scolds you if you eat three cakes" (per in-game day). */
export const CAKE_SCOLD_COUNT = 3;
/** The Barista notices from this many coffees a day (my number). */
export const COFFEE_JITTERS_COUNT = 3;

const english = (id: ItemId) => id.replace(/_/g, " ");

/**
 * Context flags for an NPC turn (npc-runtime.md §1 "Extra context"; architecture §5.3: built by the
 * server, never by the client) about what the player ate today: the Doctor scolds after three
 * cakes, the Baker is pleased the player ate their baking, the Barista notices the coffees.
 */
export function eatingFlags(npcId: NpcId, log: EatLog | null, today: number): string[] {
  if (!log || log.day !== today) return [];
  const flags: string[] = [];
  if (npcId === "doctor") {
    const cakes = eatenToday(log, "cake", today);
    if (cakes >= CAKE_SCOLD_COUNT) flags.push(`the player has eaten ${cakes} cakes today: as their doctor, kindly scold them about so much sugar`);
  }
  if (npcId === "baker") {
    const baked = (SHOPS.baker?.sells ?? []).filter((id) => eatenToday(log, id, today) > 0);
    if (baked.length) flags.push(`the player ate your ${baked.map(english).join(" and ")} today`);
  }
  if (npcId === "barista") {
    const coffees = eatenToday(log, "coffee", today);
    if (coffees >= COFFEE_JITTERS_COUNT) flags.push(`the player has had ${coffees} coffees today and may be a little jittery`);
  }
  return flags;
}

/** Whether an item can be eaten at all (for the hotbar's eat button). */
export function isEdible(itemId: string): boolean {
  return getItem(itemId) !== undefined && isConsumable(itemId as ItemId);
}
