import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Type-only: importing values from shared here would pull zod into the entry chunk.
import type { InteractableKind, SpaceId } from "@hellovalley/shared";

/**
 * Which space the diorama shows (build plan M13): the town or one interior, plus the door fade.
 * The player controller (scene/Player.tsx) switches `space` at the darkest point of the fade;
 * the interior sets `ready` once its meshes are built so the fade-in waits for them.
 * TODO(M16/M17): the TownRoom / ApartmentRoom confirm space changes.
 */
export interface WorldState {
  space: SpaceId;
  /** The shown space's meshes are on screen. */
  ready: boolean;
  /** Door fade cover, 0 = clear, 1 = fully covered. Written per frame; read by FadeOverlay. */
  fade: number;
  /** The interactable the player stands next to (F uses it), or null. Set by scene/Player.tsx on change. */
  nearby: { id: string; kind: InteractableKind } | null;
  setSpace: (space: SpaceId) => void;
  setReady: (ready: boolean) => void;
}

export function createWorldStore(space: SpaceId = "town") {
  return createStore<WorldState>()((set) => ({
    space,
    ready: space === "town",
    fade: 0,
    nearby: null,
    setSpace: (next) => set((s) => (s.space === next ? s : { space: next, ready: next === "town" })),
    setReady: (ready) => set({ ready }),
  }));
}

export const worldStore = createWorldStore();

export function useWorld<T>(selector: (state: WorldState) => T): T {
  return useStore(worldStore, selector);
}
