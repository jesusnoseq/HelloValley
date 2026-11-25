import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: importing values from shared here would pull zod into the entry chunk.
import type {
  Correction,
  InputMethod,
  ItemId,
  NpcContextMessage,
  NpcId,
  NpcLine,
  NpcRefusal,
  PendingTrade,
  SuggestedReply,
  SuggestionStyle,
  Teach,
} from "@hellovalley/shared";

/**
 * The NPC conversation as the UI shows it (build plan M23, GDD §6.2, §8.1). Plain state only;
 * the logic is ui/conversation/controller.ts (a lazy chunk, it carries shared game rules). The
 * proximity chat, the player controller and the NPCs in the scene read it: while a conversation
 * is open Enter belongs to the reply box, the camera eases in on the pair and both face each other.
 */

export type ConversationPhase =
  /** No conversation. */
  | "idle"
  /** `npc:start` sent; waiting for the context and the opener. */
  | "starting"
  /** The player's turn. */
  | "open"
  /** A player line is with the model and the server. */
  | "thinking"
  /** The NPC said goodbye or cannot talk any more; pending cards can still be answered. */
  | "ended"
  /** It could not start (offline, refused): the panel shows why, with a Close button. */
  | "unavailable";

export type LogEntry =
  | {
      id: number;
      kind: "npc";
      line: NpcLine;
      teach?: Teach;
      /** The cached opener: shared content that may have a seeded voice clip (M22). */
      seeded?: boolean;
    }
  | {
      id: number;
      kind: "player";
      text: string;
      method: InputMethod;
      /** The NPC's soft correction of this line (the reply's `correction`). */
      correction?: Correction;
      /** Written in the player's native language (on-device detection): gently redirected. */
      native?: boolean;
    };

export type TradeStatus = "open" | "sending" | "done" | "declined" | "failed";

export type Card =
  | { id: number; kind: "trade"; trade: PendingTrade; status: TradeStatus; reason?: string }
  | { id: number; kind: "gift"; itemId: ItemId }
  | { id: number; kind: "quest"; questId: string }
  | { id: number; kind: "recipe"; recipeId: string };

/** The grammar check before sending (GDD §6.2): soft, never blocking. */
export type CheckState =
  | { status: "idle" }
  | { status: "checking"; text: string }
  | { status: "suggest"; text: string; method: InputMethod; better: string; note?: string };

export type ConversationNotice =
  | { kind: "offline" }
  | { kind: "refused"; reason: NpcRefusal | "timeout" }
  /** The model answer could not be used: say it again. */
  | { kind: "retry" }
  /** The NPC cannot talk now (repeated failures, limits). */
  | { kind: "busy" }
  /** The last line was in the native language: the NPC answers in the target language. */
  | { kind: "native" };

export interface ConversationState {
  phase: ConversationPhase;
  npcId: NpcId | null;
  context: NpcContextMessage | null;
  log: LogEntry[];
  /** Line texts of the NPC's answer while it streams in. */
  streaming: string[];
  suggestions: SuggestedReply[];
  /** How the suggestions are offered at this level. */
  style: SuggestionStyle;
  /** C1+: the 💡 reply has been revealed. */
  hintShown: boolean;
  check: CheckState;
  cards: Card[];
  notice: ConversationNotice | null;
  /** The player's coins as the server last said. */
  coins: number | null;
  /** A clicked NPC the player is walking to; the conversation starts on arrival. */
  pendingTalk: NpcId | null;
}

export const IDLE_CONVERSATION: Omit<ConversationState, "pendingTalk"> = {
  phase: "idle",
  npcId: null,
  context: null,
  log: [],
  streaming: [],
  suggestions: [],
  style: "replies",
  hintShown: false,
  check: { status: "idle" },
  cards: [],
  notice: null,
  coins: null,
};

export type ConversationStore = StoreApi<ConversationState>;

export function createConversationStore(): ConversationStore {
  return createStore<ConversationState>()(() => ({ ...IDLE_CONVERSATION, pendingTalk: null }));
}

/** The game's conversation (one at a time). */
export const conversationStore = createConversationStore();

export function useConversation<T>(selector: (state: ConversationState) => T, store: ConversationStore = conversationStore): T {
  return useStore(store, selector);
}

/** A conversation panel is showing (another HUD must not take Enter, F or the camera). */
export function conversationActive(state: Pick<ConversationState, "phase">): boolean {
  return state.phase !== "idle";
}
