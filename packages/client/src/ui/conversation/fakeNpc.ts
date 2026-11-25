import {
  ClientMessage,
  type InventoryEntry,
  type NpcAppliedMessage,
  type NpcConfirmMessage,
  type NpcContextMessage,
  type NpcGiftedMessage,
  type NpcGiftMessage,
  type NpcMemoryMessage,
  type NpcRememberedMessage,
  type NpcLine,
  type NpcReplyMessage,
  type NpcTradeMessage,
  type NpcTurnReplyInput,
  type PendingTrade,
  giftReaction,
  GIFT_HEARTS,
  isGiftable,
  parseNpcTurnReply,
  ServerMessage,
} from "@hellovalley/shared";
import type { NpcAi, NpcRoom } from "../../net/npcConversation";

/**
 * A scripted game server and model for conversation tests (build plan M23): the room answers
 * `npc:start`, `npc:reply` and `npc:confirm` like the TownRoom does (trades at the server's
 * stock price, coins settled on confirm), gifts (`npc:gift`) and memories (`npc:memory`, answered
 * with `levelChange`), and the "model" answers the Baker's lines by keyword.
 * Test-only: nothing in the game imports it.
 */

export interface FakeServer {
  room: NpcRoom;
  sent: { type: string; payload: unknown }[];
  coins: () => number;
  inventory: () => InventoryEntry[];
}

export function fakeNpcServer(context: NpcContextMessage, options: { refuse?: NpcContextMessage["npcId"]; levelChange?: -1 | 0 | 1 } = {}): FakeServer {
  const handlers = new Map<string, Set<(m: unknown) => void>>();
  const sent: FakeServer["sent"] = [];
  let coins = context.coins;
  let inventory: InventoryEntry[] = [...context.inventory];
  let turn = 1;
  let hearts = context.hearts;
  let gifted = false;
  let tradeSeq = 0;
  const trades = new Map<string, PendingTrade>();
  const emit = (type: string, message: unknown) => {
    for (const h of [...(handlers.get(type) ?? [])]) h(message);
  };
  const respond = (type: string, payload: unknown) => {
    if (type === ClientMessage.NpcStart) {
      if (options.refuse) emit(ServerMessage.NpcRefused, { reason: "too_far", npcId: options.refuse });
      else emit(ServerMessage.NpcContext, { ...context, turnId: `turn-${turn}`, coins });
    } else if (type === ClientMessage.NpcReply) {
      const reply = payload as NpcReplyMessage;
      const pending: PendingTrade[] = [];
      for (const a of reply.actions) {
        if (a.type !== "offer") continue;
        // The server ignores the model's price and uses its own.
        const unitPrice = context.stock.find((s) => s.itemId === a.itemId)?.price ?? 1;
        const qty = a.qty ?? 1;
        const trade: PendingTrade = { tradeId: `trade-${++tradeSeq}`, kind: "offer", itemId: a.itemId as PendingTrade["itemId"], qty, unitPrice, price: unitPrice * qty };
        trades.set(trade.tradeId, trade);
        pending.push(trade);
      }
      const ended = reply.actions.some((a) => a.type === "endConversation");
      turn++;
      const applied: NpcAppliedMessage = {
        conversationId: reply.conversationId,
        turnId: reply.turnId,
        accepted: pending.map((p) => ({ type: "offer", itemId: p.itemId, qty: p.qty, unitPrice: p.unitPrice, price: p.price })),
        rejected: [],
        trades: pending,
        nextTurnId: ended ? null : `turn-${turn}`,
        ended,
        hearts,
        stock: context.stock,
        inventory,
      };
      emit(ServerMessage.NpcApplied, applied);
    } else if (type === ClientMessage.NpcGift) {
      const gift = payload as NpcGiftMessage;
      const held = inventory.find((e) => e.itemId === gift.itemId)?.qty ?? 0;
      const reason = !isGiftable(gift.itemId) ? "not_giftable" : gifted ? "gift_cap" : held < 1 ? "not_owned" : null;
      let answer: NpcGiftedMessage;
      if (reason) answer = { conversationId: gift.conversationId, itemId: gift.itemId, ok: false, reason, delta: 0, hearts, inventory };
      else {
        const reaction = giftReaction(context.npcId, gift.itemId);
        const before = hearts;
        hearts = Math.min(10, Math.max(0, hearts + GIFT_HEARTS[reaction]));
        gifted = true;
        inventory = inventory.flatMap((e) => (e.itemId !== gift.itemId ? [e] : e.qty > 1 ? [{ ...e, qty: e.qty - 1 }] : []));
        answer = { conversationId: gift.conversationId, itemId: gift.itemId, ok: true, reaction, delta: hearts - before, hearts, inventory };
      }
      emit(ServerMessage.NpcGifted, answer);
    } else if (type === ClientMessage.NpcMemory) {
      const memory = payload as NpcMemoryMessage;
      const answer: NpcRememberedMessage = { conversationId: memory.conversationId, npcId: context.npcId, level: context.playerLevel, levelChange: options.levelChange ?? 0 };
      emit(ServerMessage.NpcRemembered, answer);
    } else if (type === ClientMessage.NpcConfirm) {
      const confirm = payload as NpcConfirmMessage;
      const trade = trades.get(confirm.tradeId);
      trades.delete(confirm.tradeId);
      let answer: NpcTradeMessage;
      if (!trade) answer = { tradeId: confirm.tradeId, ok: false, reason: "unknown_trade", coins, inventory };
      else if (!confirm.accept) answer = { tradeId: confirm.tradeId, ok: false, reason: "declined", coins, inventory };
      else if (coins < trade.price) answer = { tradeId: confirm.tradeId, ok: false, reason: "insufficient_coins", coins, inventory };
      else {
        coins -= trade.price;
        inventory = [...inventory.filter((e) => e.itemId !== trade.itemId), { itemId: trade.itemId, qty: (inventory.find((e) => e.itemId === trade.itemId)?.qty ?? 0) + trade.qty }];
        answer = { tradeId: confirm.tradeId, ok: true, coins, inventory };
      }
      emit(ServerMessage.NpcTrade, answer);
    }
  };
  const room: NpcRoom = {
    send: (type, payload) => {
      sent.push({ type, payload });
      setTimeout(() => respond(type, payload), 0);
    },
    onMessage: <T,>(type: string, handler: (m: T) => void) => {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (m: unknown) => void);
      handlers.set(type, set);
      return () => set.delete(handler as (m: unknown) => void);
    },
  };
  return { room, sent, coins: () => coins, inventory: () => inventory };
}

const words = (text: string, glosses: Record<string, string> = {}): NpcLine["tokens"] =>
  (text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+/gu) ?? []).map((surface) =>
    /[\p{L}\p{N}]/u.test(surface) ? { surface, gloss: glosses[surface.toLowerCase()] ?? "" } : { surface, gloss: "", pos: "punct" as const },
  );

const line = (text: string, translation: string, glosses?: Record<string, string>) => ({ text, translation, tokens: words(text, glosses) });

/** "¡Hola, cariño! ¿Qué quieres hoy?" */
export const FAKE_OPENER: NpcLine = { ...line("¡Hola, cariño! ¿Qué quieres hoy?", "Hello, dear! What would you like today?", { hola: "hello", cariño: "dear" }), emotion: "happy" };

/** The Baker's answers by keyword (Spanish, A1). */
export function fakeBakerReply(playerText: string): NpcTurnReplyInput {
  const t = playerText.toLowerCase();
  if (/adi[oó]s|chao/.test(t)) {
    return { lines: [line("¡Adiós, cariño! Vuelve pronto.", "Bye, dear! Come back soon.")], suggestedReplies: [], actions: [{ type: "endConversation" }] };
  }
  if (/thank|thanks/.test(t)) {
    return {
      lines: [line("¡De nada, cariño!", "You're welcome, dear!")],
      suggestedReplies: [{ text: "Gracias.", translation: "Thank you." }],
      teach: { phrase: "Gracias", meaning: "Thank you" },
      actions: [],
    };
  }
  if (/pan|tienes|cuesta/.test(t)) {
    return {
      lines: [line("¡Sí, cariño! Pan, cinco monedas.", "Yes, dear! Bread, five coins.", { pan: "bread", cinco: "five", monedas: "coins" })],
      suggestedReplies: [
        { text: "Sí, por favor.", translation: "Yes, please." },
        { text: "¿Cuánto cuesta?", translation: "How much is it?" },
        { text: "No, gracias.", translation: "No, thank you." },
      ],
      // The model's price is wrong on purpose: the server recomputes it.
      actions: [{ type: "offer", itemId: "bread", qty: 1, price: 1 }],
    };
  }
  return { lines: [line("¿Qué quieres, cariño?", "What would you like, dear?")], suggestedReplies: [{ text: "Quiero pan.", translation: "I want bread." }], actions: [] };
}

/** A model that answers with `fakeBakerReply` and opens with FAKE_OPENER. */
export function fakeNpcAi(reply: (playerText: string) => NpcTurnReplyInput = fakeBakerReply): NpcAi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    run: async ({ playerText, onText }) => {
      calls.push(playerText);
      const parsed = parseNpcTurnReply(JSON.stringify(reply(playerText)));
      if (!parsed.ok) throw new Error(parsed.error);
      onText?.(parsed.reply.lines.map((l) => l.text));
      return { ok: true, reply: parsed.reply, attempts: 1 };
    },
    canned: () => null,
    opener: async () => ({ line: FAKE_OPENER, source: "cache", personalised: false }),
    compact: async ({ playerName }) => ({
      summary: `${playerName} likes bread.`,
      facts: [`${playerName} likes bread`],
      signals: { comprehension: 0.8, expression: 0.6, usedNativeLanguage: false, struggles: [] },
    }),
  };
}
