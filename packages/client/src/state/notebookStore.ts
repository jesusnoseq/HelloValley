import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: the notebook rules (shared values, zod) stay in the lazy notebook chunk.
import type { NotebookItem, StreakState } from "@hellovalley/shared";

/**
 * The player's notebook for the current target language (build plan M25, GDD §6.3): the entries
 * (mirrored from `users/{uid}/langs/{lang}/notebook`), the review streak from `langs/{lang}`, the
 * last save (for the "saved" feedback) and whether the notebook panel is open. The logic is in
 * `notebook/notebook.ts`.
 */
export type SaveOutcome = "saved" | "exists" | "failed" | "invalid" | "off";

export interface NotebookState {
  status: "off" | "loading" | "ready" | "error";
  lang: string | null;
  nativeLang: string | null;
  items: readonly NotebookItem[];
  streak: StreakState;
  lastSave: { id: string; surface: string; outcome: SaveOutcome; at: number } | null;
  open: boolean;
}

export type NotebookStore = StoreApi<NotebookState>;

export const initialNotebookState = (): NotebookState => ({
  status: "off",
  lang: null,
  nativeLang: null,
  items: [],
  streak: { streak: 0, day: null },
  lastSave: null,
  open: false,
});

export function createNotebookStore(): NotebookStore {
  return createStore<NotebookState>()(() => initialNotebookState());
}

export const notebookStore = createNotebookStore();

export function useNotebook<T>(selector: (state: NotebookState) => T, store: NotebookStore = notebookStore): T {
  return useStore(store, selector);
}

export function setNotebookOpen(open: boolean, store: NotebookStore = notebookStore): void {
  store.setState({ open });
}
