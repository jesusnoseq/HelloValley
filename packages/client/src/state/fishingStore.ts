import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: the fishing rules (shared, with zod) stay in the lazy fishing chunk.
import type { FishCastRefusal, FishCastResultMessage, FishLog, FishReelRefusal, FishResultMessage, ReelState, Vec2 } from "@hellovalley/shared";

/**
 * Fishing on the client (build plan M27, GDD §5.2): which step of a cast the player is in, the
 * server's answers (`fish:cast`, `fish:result`) and the encyclopedia it sent (`fish:log`). The
 * fish itself is the server's secret until it is landed; this store only shows what it said.
 *
 * Steps: idle → charging (holding the cast button) → casting (waiting for the server) → waiting
 * (the shadow approaches) → bite (hook it now) → reeling (the mini-game) → landing (waiting for
 * the server's verdict) → result (the catch card), or back to idle with a `notice`.
 */
export type FishingPhase = "idle" | "charging" | "casting" | "waiting" | "bite" | "reeling" | "landing" | "result";

export type FishingNotice = "early" | "late" | "escaped" | FishCastRefusal | FishReelRefusal | null;

export type OkCast = Extract<FishCastResultMessage, { ok: true }>;

export interface FishingState {
  phase: FishingPhase;
  /** `performance.now()` when the cast button went down. */
  chargeStartMs: number | null;
  /** The heading the line goes out on (the player faces it). */
  heading: number | null;
  cast: OkCast | null;
  /** `performance.now()` of the bite on this client (the server's delay from when its answer arrived). */
  biteAtMs: number | null;
  reel: ReelState | null;
  result: FishResultMessage | null;
  /** Why the last cast or reel ended without a card, until the next cast. */
  notice: FishingNotice;
  log: FishLog;
  logLoaded: boolean;
  /** The fish encyclopedia panel is open. */
  bookOpen: boolean;
}

export type FishingStore = StoreApi<FishingState>;

export const initialFishingState = (): FishingState => ({
  phase: "idle",
  chargeStartMs: null,
  heading: null,
  cast: null,
  biteAtMs: null,
  reel: null,
  result: null,
  notice: null,
  log: {},
  logLoaded: false,
  bookOpen: false,
});

export function createFishingStore(): FishingStore {
  return createStore<FishingState>()(() => initialFishingState());
}

export const fishingStore = createFishingStore();

export function useFishing<T>(selector: (state: FishingState) => T, store: FishingStore = fishingStore): T {
  return useStore(store, selector);
}

/** The line is out (or about to be): the walker stands still and faces the water. */
export function fishingActive(state: FishingState = fishingStore.getState()): boolean {
  return state.phase !== "idle" && state.phase !== "result";
}

/** Per-frame data the player controller writes and the fishing UI reads (no re-renders). */
export const fishingLive = {
  /** The local player's position in the town, or null indoors. */
  pos: null as Vec2 | null,
  heading: 0,
};
