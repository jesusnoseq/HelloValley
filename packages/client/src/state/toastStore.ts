import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { NpcId } from "@hellovalley/shared";

/**
 * Short game notices (build plan M24): "The Baker thinks you're improving! 🥐" when the level
 * estimate moves the player's level ½ step (GDD §6.4). Plain state; `ui/toast/Toasts.tsx` shows
 * and expires them.
 */

export type Toast = { id: number; kind: "level"; npcId: NpcId; direction: 1 | -1 };

export interface ToastState {
  toasts: Toast[];
}

/** Toasts shown at once; older ones go first. */
export const MAX_TOASTS = 3;
/** How long a toast stays (ms). */
export const TOAST_MS = 6000;

export type ToastStore = StoreApi<ToastState> & {
  push(toast: Omit<Toast, "id">): number;
  dismiss(id: number): void;
};

export function createToastStore(): ToastStore {
  const store = createStore<ToastState>()(() => ({ toasts: [] }));
  let next = 1;
  return Object.assign(store, {
    push(toast: Omit<Toast, "id">) {
      const id = next++;
      store.setState((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
      return id;
    },
    dismiss(id: number) {
      store.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  });
}

export const toastStore = createToastStore();

export function useToasts(store: ToastStore = toastStore): Toast[] {
  return useStore(store, (s) => s.toasts);
}
