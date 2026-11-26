import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: the food rules (shared, with zod) stay in the lazy chunks.
import type { BuffKind, CookResultMessage, FoodEatenMessage, ItemId, RecipeBook, SitRefusal } from "@hellovalley/shared";

/**
 * Eating, sitting and cooking on the client (build plan M29, GDD §5.4): what the server said and
 * nothing more. The running buffs (`buffs:state`, with their end on the local clock for the HUD),
 * the recipe book, the answer to the last bite and dish, the seat the player sits on, the seat
 * within reach (set by scene/Player.tsx) and whether the kitchen panel is open.
 */

export interface ClientBuff {
  kind: BuffKind;
  amount: number;
  itemId: ItemId;
  /** `Date.now()` when it runs out (from the server's remaining time). */
  endsAt: number;
  durationMs: number;
}

export interface FoodState {
  buffs: readonly ClientBuff[];
  book: RecipeBook;
  bookLoaded: boolean;
  /** The server's answer to the last bite, until it fades. */
  lastEaten: FoodEatenMessage | null;
  /** A `food:eat` is on its way. */
  eating: boolean;
  /** `Date.now()` until which the local avatar plays the eat clip (after an accepted bite). */
  eatingUntil: number;
  /** The server's answer to the last dish, until the next one. */
  lastCooked: CookResultMessage | null;
  cooking: boolean;
  /** The seat the player sits on (the server's word), or null. */
  seat: string | null;
  /** Why the last sit was refused. */
  seatRefused: SitRefusal | null;
  /** The seat within reach of the local player, or null. */
  nearbySeat: string | null;
  /** The kitchen panel (recipe cards) is open. */
  kitchenOpen: boolean;
}

export type FoodStore = StoreApi<FoodState>;

export const initialFoodState = (): FoodState => ({
  buffs: [],
  book: { known: {} },
  bookLoaded: false,
  lastEaten: null,
  eating: false,
  eatingUntil: 0,
  lastCooked: null,
  cooking: false,
  seat: null,
  seatRefused: null,
  nearbySeat: null,
  kitchenOpen: false,
});

export function createFoodStore(): FoodStore {
  return createStore<FoodState>()(() => initialFoodState());
}

export const foodStore = createFoodStore();

export function useFood<T>(selector: (state: FoodState) => T, store: FoodStore = foodStore): T {
  return useStore(store, selector);
}

/** The running buffs at `now` (the HUD drops one when it runs out, before the server says so). */
export function liveBuffs(buffs: readonly ClientBuff[], now: number): ClientBuff[] {
  return buffs.filter((b) => b.endsAt > now);
}

/** The walk speed multiplier the local walker uses (the server's movement check uses the same buff). */
export function localSpeedFactor(state: Pick<FoodState, "buffs">, now: number): number {
  const b = liveBuffs(state.buffs, now).find((x) => x.kind === "walk_speed");
  return b ? 1 + Math.min(0.25, Math.max(0, b.amount)) : 1;
}
