import {
  ClientMessage,
  type CompactionPromptInput,
  type CompactionResponse,
  type ConversationTelemetry,
  getNpc,
  type ItemId,
  type LostItemId,
  type NpcReturnedMessage,
  type NpcReturnMessage,
  type NpcAppliedMessage,
  type NpcGiftedMessage,
  type NpcGiftMessage,
  type NpcMemoryMessage,
  type NpcRememberedMessage,
  type TranscriptTurn,
  type NpcConfirmMessage,
  type NpcContextMessage,
  type NpcEndMessage,
  type NpcHistoryTurn,
  type NpcId,
  type NpcLine,
  type NpcPlayerInfo,
  type NpcRefusal,
  type NpcRefusedMessage,
  type NpcReplyMessage,
  type NpcTradeMessage,
  type NpcTurnReply,
  type InputMethod,
  ServerMessage,
} from "@hellovalley/shared";
import type { OpenerResult } from "../ai/openers";
import type { NpcTurnResult } from "../ai/templates";

/**
 * One NPC conversation on the client (build plan M21, architecture §5.3): `npc:start` → the
 * server's context → opener → for each player line, the model turn (client, AI Logic) → the
 * reply's actions to the server as `npc:reply` → `npc:applied` (what the server accepted, with its
 * prices) → `npc:confirm` for trades. The conversation UI (M23) drives this.
 *
 * After two unusable turns in a row, or when the server stops issuing turn ids, the NPC answers
 * with the canned "come back later" line.
 */

/** The part of a Colyseus room this needs (tests pass a fake). */
export interface NpcRoom {
  send(type: string, payload: unknown): void;
  onMessage<T>(type: string, handler: (message: T) => void): () => void;
}

export interface NpcAi {
  run(input: {
    context: NpcContextMessage;
    player: NpcPlayerInfo;
    history: readonly NpcHistoryTurn[];
    playerText: string;
    method: InputMethod;
    onText?: (lines: string[]) => void;
  }): Promise<NpcTurnResult>;
  canned(kind: "retry" | "busy", context: Pick<NpcContextMessage, "lang" | "nativeLang">): NpcLine | null;
  opener?(context: NpcContextMessage, playerName: string): Promise<OpenerResult | null>;
  /**
   * Conversation compaction (npc-runtime.md §7, build plan M24): the hybrid `compactConversation`
   * task, on-device first with the AI Logic cloud fallback. Null: keep the previous memory.
   */
  compact?(input: CompactionPromptInput): Promise<CompactionResponse | null>;
}

/** How long to wait for a server answer (ms). */
export const NPC_SERVER_TIMEOUT_MS = 8000;
/** Unusable turns in a row before the NPC is "busy". */
export const NPC_FAILS_BEFORE_BUSY = 2;

export class NpcRefusedError extends Error {
  constructor(readonly reason: NpcRefusal | "timeout") {
    super(`npc: ${reason}`);
  }
}

export type SayResult =
  | { ok: true; reply: NpcTurnReply; applied: NpcAppliedMessage }
  /** The NPC's fallback line (null: show the UI's own "busy" message), and whether it may be retried. */
  | { ok: false; line: NpcLine | null; retry: boolean; reason: NpcRefusal | "model" | "ended" | "timeout" };

function waitFor<T>(room: NpcRoom, type: string, match: (m: T) => boolean, refused: (m: NpcRefusedMessage) => boolean): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stops: (() => void)[] = [];
    const done = () => {
      clearTimeout(timer);
      for (const stop of stops) stop();
    };
    const timer = setTimeout(() => {
      done();
      reject(new NpcRefusedError("timeout"));
    }, NPC_SERVER_TIMEOUT_MS);
    stops.push(
      room.onMessage<T>(type, (m) => {
        if (!match(m)) return;
        done();
        resolve(m);
      }),
      room.onMessage<NpcRefusedMessage>(ServerMessage.NpcRefused, (m) => {
        if (!refused(m)) return;
        done();
        reject(new NpcRefusedError(m.reason));
      }),
    );
  });
}

export class NpcConversation {
  private history: NpcHistoryTurn[] = [];
  private fails = 0;

  private constructor(
    private readonly room: NpcRoom,
    private readonly ai: NpcAi,
    private readonly player: NpcPlayerInfo,
    public context: NpcContextMessage,
    /** The turn id the next reply carries; null when the server issues no more. */
    private turnId: string | null,
  ) {}

  /** Starts a conversation; rejects with NpcRefusedError when the server refuses. */
  static async start(room: NpcRoom, ai: NpcAi, player: NpcPlayerInfo, npcId: NpcId): Promise<NpcConversation> {
    const reply = waitFor<NpcContextMessage>(room, ServerMessage.NpcContext, (m) => m.npcId === npcId, (m) => m.npcId === npcId);
    room.send(ClientMessage.NpcStart, { npcId });
    const context = await reply;
    return new NpcConversation(room, ai, player, context, context.turnId);
  }

  get canTalk(): boolean {
    return this.turnId !== null;
  }

  /** The cached (maybe personalised) opener, or null. */
  async opener(): Promise<NpcLine | null> {
    const found = await this.ai.opener?.(this.context, this.player.name).catch(() => null);
    if (found) this.history.push({ player: "", npc: found.line.text });
    return found?.line ?? null;
  }

  /** One player line: the model turn, then the server's verdict on its actions. */
  async say(text: string, method: InputMethod, onText?: (lines: string[]) => void): Promise<SayResult> {
    const busy = () => this.ai.canned("busy", this.context);
    if (!this.turnId) return { ok: false, line: busy(), retry: false, reason: "ended" };
    const turn = await this.ai.run({ context: this.context, player: this.player, history: this.history, playerText: text, method, ...(onText ? { onText } : {}) });
    if (!turn.ok) {
      this.fails++;
      const giveUp = turn.reason === "unavailable" || this.fails >= NPC_FAILS_BEFORE_BUSY;
      return { ok: false, line: giveUp ? busy() : turn.fallback, retry: !giveUp, reason: "model" };
    }
    this.fails = 0;
    const turnId = this.turnId;
    // Goodbye (or walking away) while the model was answering: nothing goes to the server.
    if (!turnId) return { ok: false, line: null, retry: false, reason: "ended" };
    const message: NpcReplyMessage = { conversationId: this.context.conversationId, turnId, actions: turn.reply.actions };
    const answer = waitFor<NpcAppliedMessage>(this.room, ServerMessage.NpcApplied, (m) => m.turnId === turnId, (m) => m.turnId === turnId);
    this.room.send(ClientMessage.NpcReply, message);
    try {
      const applied = await answer;
      this.turnId = applied.nextTurnId;
      this.context = { ...this.context, hearts: applied.hearts, stock: applied.stock, inventory: applied.inventory };
      this.history.push({ player: text, npc: turn.reply.lines.map((l) => l.text).join(" ") });
      return { ok: true, reply: turn.reply, applied };
    } catch (error) {
      const reason = error instanceof NpcRefusedError ? error.reason : "timeout";
      // The NPC's lines still show; only the actions did not reach the game. `rate`: try again.
      return { ok: false, line: busy(), retry: reason === "rate" || reason === "unavailable", reason };
    }
  }

  /** Accepts or declines a trade the server offered (the M23 confirmation card). */
  async confirm(tradeId: string, accept: boolean): Promise<NpcTradeMessage> {
    const answer = waitFor<NpcTradeMessage>(this.room, ServerMessage.NpcTrade, (m) => m.tradeId === tradeId, (m) => m.conversationId === this.context.conversationId && !m.turnId);
    const message: NpcConfirmMessage = { conversationId: this.context.conversationId, tradeId, accept };
    this.room.send(ClientMessage.NpcConfirm, message);
    const trade = await answer;
    this.context = { ...this.context, coins: trade.coins, inventory: trade.inventory };
    return trade;
  }

  /** Player lines the server accepted a turn for. */
  get playerTurns(): number {
    return this.history.filter((t) => t.player.trim() !== "").length;
  }

  /** The conversation as a transcript for the compaction (opener included). */
  transcript(): TranscriptTurn[] {
    return this.history.flatMap((t): TranscriptTurn[] => [...(t.player.trim() ? [{ speaker: "player" as const, text: t.player }] : []), { speaker: "npc", text: t.npc }]);
  }

  /** Gives the NPC one item from the inventory (build plan M24); the server decides how it lands. */
  async gift(itemId: ItemId): Promise<NpcGiftedMessage> {
    const id = this.context.conversationId;
    const answer = waitFor<NpcGiftedMessage>(this.room, ServerMessage.NpcGifted, (m) => m.conversationId === id && m.itemId === itemId, (m) => m.conversationId === id && !m.turnId);
    const message: NpcGiftMessage = { conversationId: id, itemId };
    this.room.send(ClientMessage.NpcGift, message);
    const gifted = await answer;
    this.context = { ...this.context, hearts: gifted.hearts, inventory: gifted.inventory, giftedToday: this.context.giftedToday || gifted.ok || gifted.reason === "gift_cap" };
    return gifted;
  }

  /** Hands a lost item back to its owner (build plan M28); the server checks the owner and adds the hearts. */
  async returnLost(itemId: LostItemId): Promise<NpcReturnedMessage> {
    const id = this.context.conversationId;
    const answer = waitFor<NpcReturnedMessage>(this.room, ServerMessage.NpcReturned, (m) => m.conversationId === id && m.itemId === itemId, (m) => m.conversationId === id && !m.turnId);
    const message: NpcReturnMessage = { conversationId: id, itemId };
    this.room.send(ClientMessage.NpcReturn, message);
    const returned = await answer;
    this.context = { ...this.context, hearts: returned.hearts, inventory: returned.inventory, flags: returned.ok ? this.context.flags.filter((f) => !f.includes("your lost")) : this.context.flags };
    return returned;
  }

  /** Goodbye or walk-away: `npc:end` goes at once; `remember` sends the compaction after it. */
  end(): void {
    const message: NpcEndMessage = { conversationId: this.context.conversationId };
    this.room.send(ClientMessage.NpcEnd, message);
    this.turnId = null;
  }

  /**
   * After `end`: compacts the conversation (on-device first, AI Logic cloud fallback; architecture
   * §5.2) and sends it as `npc:memory`. Null when there is nothing to remember (no player turn),
   * no compaction (the previous memory stays), or no answer from the server.
   */
  async remember(telemetry: ConversationTelemetry, nativeLang = this.context.nativeLang): Promise<NpcRememberedMessage | null> {
    if (this.playerTurns === 0 || !this.ai.compact) return null;
    const ctx = this.context;
    const compacted = await this.ai
      .compact({
        npcName: getNpc(ctx.npcId).englishName,
        playerName: this.player.name,
        nativeLang,
        targetLang: ctx.lang,
        memorySummary: ctx.memory?.summary ?? "",
        turns: this.transcript(),
      })
      .catch(() => null);
    if (!compacted) return null;
    const id = ctx.conversationId;
    const message: NpcMemoryMessage = { conversationId: id, ...compacted, telemetry };
    const answer = waitFor<NpcRememberedMessage>(this.room, ServerMessage.NpcRemembered, (m) => m.conversationId === id, (m) => m.conversationId === id && !m.turnId);
    this.room.send(ClientMessage.NpcMemory, message);
    return answer.catch(() => null);
  }
}
