import type { ItemId } from "../data/items";

/**
 * Inventory slots (GDD §5.6: 24 slots + 6 hotbar), as the server stores them in
 * `users/{uid}/inventory/{slot}` with the slot index as the document id. Pure helpers used by the
 * server's stores when a trade or a gift lands (build plan M21).
 * TODO(M26): stack limits, hotbar assignment, the inventory UI.
 */
export const INVENTORY_SLOTS = 24;
export const HOTBAR_SLOTS = 6;
export const TOTAL_SLOTS = INVENTORY_SLOTS + HOTBAR_SLOTS;
/** Most of one item in a slot (my number). */
export const MAX_STACK = 99;

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
