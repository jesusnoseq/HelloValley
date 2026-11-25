import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Type-only: importing values from shared here would pull zod into the entry chunk.
import type { FurnitureId, FurnitureRotation } from "@hellovalley/shared";

/**
 * Furniture placement mode in the player's own apartment (build plan M17, GDD §4.2): whether it
 * is open, the piece in hand (a placed piece being moved, or one taken out of storage) and its
 * rotation. The scene (scene/PlacementMode.tsx) moves the ghost with the pointer and sends the
 * edit when it is dropped; player input pauses while the mode is open.
 */
export type HeldPiece = { kind: "placed"; index: number; itemId: FurnitureId } | { kind: "stored"; itemId: FurnitureId };

export interface PlacementState {
  open: boolean;
  held: HeldPiece | null;
  rot: FurnitureRotation;
  setOpen: (open: boolean) => void;
  hold: (held: HeldPiece | null, rot?: FurnitureRotation) => void;
  /** A quarter turn clockwise as seen from above. */
  rotate: () => void;
}

export const nextRotation = (rot: FurnitureRotation): FurnitureRotation => ((rot + 90) % 360) as FurnitureRotation;

export function createPlacementStore() {
  return createStore<PlacementState>()((set) => ({
    open: false,
    held: null,
    rot: 0,
    setOpen: (open) => set({ open, held: null }),
    hold: (held, rot) => set((s) => ({ held, rot: rot ?? s.rot })),
    rotate: () => set((s) => ({ rot: nextRotation(s.rot) })),
  }));
}

export const placementStore = createPlacementStore();

export function usePlacement<T>(selector: (state: PlacementState) => T): T {
  return useStore(placementStore, selector);
}
