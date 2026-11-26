import type { ItemId } from "../data/items";

/**
 * Inventory slots (GDD §5.6: 24 slots + 6 hotbar), as the server stores them in
 * `users/{uid}/inventory/{slot}` with the slot index as the document id: slots 0–23 are the bag,
 * 24–29 the hotbar. New items fill the lowest free slot, so they land in the bag first and the
 * player drags what they want at hand into the hotbar (build plan M26). Pure helpers used by the
 * server's stores when a trade, a gift or a move lands; the server is the only writer.
 */
export const INVENTORY_SLOTS = 24;
export const HOTBAR_SLOTS = 6;
export const TOTAL_SLOTS = INVENTORY_SLOTS + HOTBAR_SLOTS;
/** The first hotbar slot. */
export const HOTBAR_FIRST_SLOT = INVENTORY_SLOTS;
/** Most of one item in a slot (my number). */
export const MAX_STACK = 99;

export function isHotbarSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= HOTBAR_FIRST_SLOT && slot < TOTAL_SLOTS;
}

export function isSlotIndex(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < TOTAL_SLOTS;
}

/** The hotbar slots in order (24–29). */
export const HOTBAR_SLOT_INDEXES: readonly number[] = Array.from({ length: HOTBAR_SLOTS }, (_, i) => HOTBAR_FIRST_SLOT + i);

export interface SlotEntry {
  slot: number;
  itemId: ItemId;
  qty: number;
}

export interface ItemDelta {
  itemId: ItemId;
  /** Positive: added; negative: removed. */
  qty: number;
}

export type ApplyItemsResult = { ok: true; slots: SlotEntry[]; changed: number[] } | { ok: false; reason: "not_owned" | "inventory_full" };

/** How many of each item the slots hold. */
export function itemCounts(slots: readonly SlotEntry[]): Partial<Record<ItemId, number>> {
  const counts: Partial<Record<ItemId, number>> = {};
  for (const s of slots) counts[s.itemId] = (counts[s.itemId] ?? 0) + s.qty;
  return counts;
}

/**
 * Applies item changes: removals take from the last stacks first, additions top up existing stacks
 * and then fill the lowest free slots. All or nothing. `changed` lists the slots to write (a slot
 * that is now missing from `slots` was emptied and should be deleted).
 */
export function applyItemDeltas(slots: readonly SlotEntry[], deltas: readonly ItemDelta[], totalSlots = TOTAL_SLOTS): ApplyItemsResult {
  const bySlot = new Map<number, SlotEntry>(slots.map((s) => [s.slot, { ...s }]));
  const changed = new Set<number>();
  for (const d of deltas) {
    if (d.qty === 0) continue;
    const stacks = [...bySlot.values()].filter((s) => s.itemId === d.itemId).sort((a, b) => a.slot - b.slot);
    if (d.qty < 0) {
      let need = -d.qty;
      if (stacks.reduce((n, s) => n + s.qty, 0) < need) return { ok: false, reason: "not_owned" };
      for (const s of stacks.reverse()) {
        if (need === 0) break;
        const take = Math.min(s.qty, need);
        s.qty -= take;
        need -= take;
        changed.add(s.slot);
        if (s.qty === 0) bySlot.delete(s.slot);
      }
      continue;
    }
    let left = d.qty;
    for (const s of stacks) {
      if (left === 0) break;
      const put = Math.min(MAX_STACK - s.qty, left);
      if (put > 0) {
        s.qty += put;
        left -= put;
        changed.add(s.slot);
      }
    }
    for (let slot = 0; left > 0 && slot < totalSlots; slot++) {
      if (bySlot.has(slot)) continue;
      const put = Math.min(MAX_STACK, left);
      bySlot.set(slot, { slot, itemId: d.itemId, qty: put });
      left -= put;
      changed.add(slot);
    }
    if (left > 0) return { ok: false, reason: "inventory_full" };
  }
  return { ok: true, slots: [...bySlot.values()].sort((a, b) => a.slot - b.slot), changed: [...changed].sort((a, b) => a - b) };
}

export type MoveSlotRefusal = "bad_slot" | "empty_slot";

export type MoveSlotResult = { ok: true; slots: SlotEntry[]; changed: number[] } | { ok: false; reason: MoveSlotRefusal };

/**
 * The player drags the stack in `from` onto `to` (bag or hotbar, build plan M26): into an empty
 * slot it moves, onto the same item it merges up to MAX_STACK (the rest stays behind), onto another
 * item the two swap. Nothing is created or lost, so a forged move can only rearrange what the
 * player already owns. `from === to` changes nothing.
 */
export function moveSlot(slots: readonly SlotEntry[], from: number, to: number, totalSlots = TOTAL_SLOTS): MoveSlotResult {
  const inRange = (s: number) => Number.isInteger(s) && s >= 0 && s < totalSlots;
  if (!inRange(from) || !inRange(to)) return { ok: false, reason: "bad_slot" };
  const bySlot = new Map<number, SlotEntry>(slots.map((s) => [s.slot, { ...s }]));
  const source = bySlot.get(from);
  if (!source) return { ok: false, reason: "empty_slot" };
  const sorted = () => [...bySlot.values()].sort((a, b) => a.slot - b.slot);
  if (from === to) return { ok: true, slots: sorted(), changed: [] };
  const target = bySlot.get(to);
  if (!target) {
    bySlot.delete(from);
    bySlot.set(to, { ...source, slot: to });
  } else if (target.itemId === source.itemId) {
    const put = Math.min(MAX_STACK - target.qty, source.qty);
    if (put <= 0) return { ok: true, slots: sorted(), changed: [] };
    target.qty += put;
    source.qty -= put;
    if (source.qty === 0) bySlot.delete(from);
  } else {
    bySlot.set(to, { ...source, slot: to });
    bySlot.set(from, { ...target, slot: from });
  }
  return { ok: true, slots: sorted(), changed: [Math.min(from, to), Math.max(from, to)] };
}
