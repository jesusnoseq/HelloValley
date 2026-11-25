import type { Room } from "@colyseus/sdk";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Values from shared that carry no zod (protocol/messages, chat/display), so the entry chunk stays small.
import {
  type BlockedPlayer,
  CHAT_MAX_LENGTH,
  type ChatBlockMessage,
  type ChatBroadcast,
  type ChatDisplayPlan,
  chatDisplayPlan,
  type ChatMuteMessage,
  type ChatReader,
  type ChatRejectedMessage,
  type ChatRejectReason,
  type ChatReportedMessage,
  type ChatReportMessage,
  type ChatReportReason,
  type ChatSafetyMessage,
  type ChatSendMessage,
  type ChatUnblockMessage,
  ClientMessage,
  ServerMessage,
} from "@hellovalley/shared";
import { lazyModeration, lazyTranslator } from "../ai/client";
import type { ChatModeration } from "../ai/moderation";
import { createCachedTranslator, type Translator } from "../ai/translate";

/**
 * The client side of proximity chat (build plan M18, GDD §6.6), over the TownRoom: the chat log,
 * the per-reader display (each line in the reader's target language, through the translator and
 * its per-message cache; the original plus a native-language translation on hover), the reader's
 * on-device moderation check, the sender's pre-check, and mute / block / report (all enforced by
 * the server; the lists here only mirror its `chat:safety`).
 */

/** How the main text of a line is shown. */
export type ShownStatus =
  /** As written (the sender wrote in the reader's target language). */
  | "original"
  /** Waiting for the translation into the target language (the original shows meanwhile). */
  | "pending"
  | "translated"
  /** No translation could be made: the original shows with a chip. */
  | "unavailable";

/** The native-language translation that hovering a line shows. */
export type HoverStatus = "none" | "idle" | "pending" | "ready" | "unavailable";

export interface ChatLine {
  id: string;
  /** The sender's TownRoom session id. */
  from: string;
  name: string;
  /** Sent by the local player. */
  own: boolean;
  /** The text as written. */
  original: string;
  /** The language it is written in. */
  lang: string;
  ts: number;
  plan: ChatDisplayPlan;
  shown: { status: ShownStatus; text: string };
  hover: { status: HoverStatus; text?: string };
  /** The reader's moderation check: null while it runs (the line is not shown yet). */
  flagged: boolean | null;
  /** The reader chose "show anyway" on a flagged line. */
  revealed: boolean;
  /** Client clock when it arrived (bubbles fade after a few seconds). */
  receivedAt: number;
}

export type ChatNotice = { kind: "rejected"; reason: ChatRejectReason } | { kind: "reported"; ok: boolean };

export interface ChatState {
  lines: readonly ChatLine[];
  /** Session ids whose chat the player muted. */
  muted: readonly string[];
  blocked: readonly BlockedPlayer[];
  /** The chat input has the keyboard (the walker stands still). */
  typing: boolean;
  /** The latest rejection or report answer, until dismissed. */
  notice: ChatNotice | null;
  reader: ChatReader | null;
  online: boolean;
}

/** Lines kept in the log (my number). */
export const CHAT_LOG_MAX = 100;

export type SendResult = "sent" | "flagged" | "empty" | "offline";

export interface ChatDeps {
  translator: Translator;
  moderation: ChatModeration;
  /** Client clock (ms), for bubble timing. */
  now?: () => number;
}

export interface ChatSession {
  readonly store: StoreApi<ChatState>;
  /** Mirrors `room`'s chat messages until the returned function runs (or the room is left). */
  attach(room: Room): () => void;
  setReader(reader: ChatReader | null): void;
  /**
   * Sends a line in `lang`. The sender-side check runs first unless `force` (the "send anyway"
   * after a flagged answer).
   */
  send(text: string, lang: string, force?: boolean): Promise<SendResult>;
  mute(sessionId: string, muted: boolean): void;
  block(sessionId: string): void;
  unblock(uid: string): void;
  report(line: Pick<ChatLine, "from" | "id">, reason: ChatReportReason): void;
  /** Starts the native-language translation for a line's hover (once). */
  requestHover(id: string): void;
  reveal(id: string): void;
  setTyping(typing: boolean): void;
  clearNotice(): void;
}

const ORIGINAL_PLAN = (lang: string): ChatDisplayPlan => ({ shownLang: lang, translateTo: null, hover: null });

export function createChatSession(deps: ChatDeps): ChatSession {
  const now = deps.now ?? (() => Date.now());
  const store = createStore<ChatState>()(() => ({ lines: [], muted: [], blocked: [], typing: false, notice: null, reader: null, online: false }));
  let room: Room | null = null;

  const send = (type: ClientMessage, payload: unknown) => {
    if (room?.connection.isOpen) room.send(type, payload);
  };
  const update = (id: string, patch: (line: ChatLine) => Partial<ChatLine>) =>
    store.setState((s) => ({ lines: s.lines.map((l) => (l.id === id ? { ...l, ...patch(l) } : l)) }));

  const receive = (m: ChatBroadcast, own: boolean) => {
    if (store.getState().lines.some((l) => l.id === m.id)) return;
    const reader = store.getState().reader;
    const plan = reader ? chatDisplayPlan(m.lang, reader) : ORIGINAL_PLAN(m.lang);
    const line: ChatLine = {
      id: m.id,
      from: m.from,
      name: m.name,
      own,
      original: m.text,
      lang: m.lang,
      ts: m.ts,
      plan,
      shown: { status: plan.translateTo ? "pending" : "original", text: m.text },
      hover: { status: plan.hover?.translateTo ? "idle" : "none" },
      flagged: own ? false : null,
      revealed: false,
      receivedAt: now(),
    };
    store.setState((s) => ({ lines: [...s.lines, line].slice(-CHAT_LOG_MAX) }));
    if (!own) {
      deps.moderation
        .checkIncoming(m.text, m.lang)
        .catch(() => ({ flagged: false }) as const)
        .then((v) => update(m.id, () => ({ flagged: v.flagged })));
    }
    if (plan.translateTo) {
      void deps.translator.translate({ messageId: m.id, text: m.text, from: m.lang, to: plan.translateTo }).then((r) =>
        update(m.id, () => ({ shown: r.ok ? { status: "translated", text: r.text } : { status: "unavailable", text: m.text } })),
      );
    }
  };

  const session: ChatSession = {
    store,

    attach(next) {
      room = next;
      store.setState({ lines: [], muted: [], blocked: [], notice: null, online: true });
      const offs = [
        next.onMessage(ServerMessage.ChatMessage, (m: ChatBroadcast) => receive(m, m.from === next.sessionId)),
        next.onMessage(ServerMessage.ChatRejected, ({ reason }: ChatRejectedMessage) => store.setState({ notice: { kind: "rejected", reason } })),
        next.onMessage(ServerMessage.ChatSafety, ({ muted, blocked }: ChatSafetyMessage) => store.setState({ muted, blocked })),
        next.onMessage(ServerMessage.ChatReported, ({ ok }: ChatReportedMessage) => store.setState({ notice: { kind: "reported", ok } })),
      ];
      let detached = false;
      const detach = () => {
        if (detached) return;
        detached = true;
        for (const off of offs) off();
        if (room === next) {
          room = null;
          store.setState({ online: false, typing: false, muted: [], blocked: [] });
        }
      };
      next.onLeave(detach);
      return detach;
    },

    setReader(reader) {
      store.setState({ reader });
    },

    async send(text, lang, force = false) {
      const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
      if (!trimmed) return "empty";
      if (!room?.connection.isOpen) return "offline";
      if (!force) {
        const verdict = await deps.moderation.checkOutgoing(trimmed, lang).catch(() => ({ flagged: false }) as const);
        if (verdict.flagged) return "flagged";
      }
      const message: ChatSendMessage = { text: trimmed, lang };
      send(ClientMessage.Chat, message);
      return "sent";
    },

    mute(sessionId, muted) {
      const message: ChatMuteMessage = { sessionId, muted };
      send(ClientMessage.ChatMute, message);
    },

    block(sessionId) {
      const message: ChatBlockMessage = { sessionId };
      send(ClientMessage.ChatBlock, message);
    },

    unblock(uid) {
      const message: ChatUnblockMessage = { uid };
      send(ClientMessage.ChatUnblock, message);
    },

    report(line, reason) {
      const message: ChatReportMessage = { sessionId: line.from, messageId: line.id, reason };
      send(ClientMessage.ChatReport, message);
    },

    requestHover(id) {
      const line = store.getState().lines.find((l) => l.id === id);
      const to = line?.plan.hover?.translateTo;
      if (!line || !to || (line.hover.status !== "idle" && line.hover.status !== "unavailable")) return;
      update(id, () => ({ hover: { status: "pending" } }));
      void deps.translator.translate({ messageId: id, text: line.original, from: line.lang, to }).then((r) =>
        update(id, () => ({ hover: r.ok ? { status: "ready", text: r.text } : { status: "unavailable" } })),
      );
    },

    reveal(id) {
      update(id, () => ({ revealed: true }));
    },

    setTyping(typing) {
      if (store.getState().typing !== typing) store.setState({ typing });
    },

    clearNotice() {
      store.setState({ notice: null });
    },
  };
  return session;
}

/**
 * The game's chat session: the hybrid AI module (build plan M20, loaded on the first line) for
 * translations, behind the per-message cache, and for the sender and reader moderation checks.
 */
export const chat = createChatSession({ translator: createCachedTranslator(lazyTranslator), moderation: lazyModeration });

export function useChat<T>(selector: (state: ChatState) => T): T {
  return useStore(chat.store, selector);
}
