import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: the item data (zod) stays in the lazy inventory chunk.
import type { InventoryMoveRefusal, SlotEntry } from "@hellovalley/shared";

/**
 * The player's coins and inventory as the server last said (build plan M26, GDD §5.6): mirrored
 * from `inventory:state`, never computed here except for the optimistic preview of a move, which
 * the server's answer replaces. Also the UI state: whether the bag (Tab) is open, the hotbar slot
 * selected, and the stack picked up to move.
 */
export interface InventoryState {
  /** `offline` until the first `inventory:state` of the current room. */
  status: "offline" | "ready";
  /** The target language whose coins these are. */
  lang: string | null;
  coins: number | null;
  slots: readonly SlotEntry[];
  /** The bag panel is open (Tab). */
  open: boolean;
  /** The selected hotbar slot (24–29), or null. Holding the rod equips it (build plan M27, ui/fishing). TODO(M29): eat from the hotbar. */
  selected: number | null;
  /** The slot picked up to move (click, then click the target), or null. */
  held: number | null;
  /** Why the last move was refused, until the next one. */
  refused: InventoryMoveRefusal | null;
}

export type InventoryStore = StoreApi<InventoryState>;

export const initialInventoryState = (): InventoryState => ({
  status: "offline",
  lang: null,
  coins: null,
  slots: [],
  open: false,
  selected: null,
  held: null,
  refused: null,
});

export function createInventoryStore(): InventoryStore {
  return createStore<InventoryState>()(() => initialInventoryState());
}

export const inventoryStore = createInventoryStore();

export function useInventory<T>(selector: (state: InventoryState) => T, store: InventoryStore = inventoryStore): T {
  return useStore(store, selector);
}

export function setInventoryOpen(open: boolean, store: InventoryStore = inventoryStore): void {
  store.setState(open ? { open } : { open, held: null });
}
