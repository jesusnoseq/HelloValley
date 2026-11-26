import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: the quest rules (shared, with zod) stay in the lazy chunks.
import type { Level, QuestResultMessage, QuestView } from "@hellovalley/shared";

/**
 * Daily requests on the client (build plan M30, GDD §5.5): today's Town Hall board and the quest
 * log as the server last sent them (`quests:state`), the server's answer to the last accept or
 * completion (`quest:result`), and which panel is open. The client never decides whether a
 * request was taken, progressed or completed: it shows what the server said.
 */
export interface QuestState {
  /** The in-game day of the board (null before the first `quests:state`). */
  day: number | null;
  /** The player's level in the target language (for the notices' level band). */
  level: Level | null;
  board: QuestView[];
  log: QuestView[];
  /** The latest `quest:result`, until it fades. */
  last: QuestResultMessage | null;
  /** A request id on its way (accept or hand-over). */
  sending: string | null;
  /** The notice board panel (F at the board). */
  boardOpen: boolean;
  /** The quest log panel (its button, or J). */
  logOpen: boolean;
}

export type QuestStore = StoreApi<QuestState>;

export const initialQuestState = (): QuestState => ({ day: null, level: null, board: [], log: [], last: null, sending: null, boardOpen: false, logOpen: false });

export function createQuestStore(): QuestStore {
  return createStore<QuestState>()(() => initialQuestState());
}

export const questStore = createQuestStore();

export function useQuests<T>(selector: (state: QuestState) => T, store: QuestStore = questStore): T {
  return useStore(store, selector);
}
