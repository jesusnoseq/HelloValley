import { ClientMessage, parseNpcTurnReply, ServerMessage, type NpcAppliedMessage, type NpcReplyMessage, type NpcTradeMessage } from "@hellovalley/shared";
import { describe, expect, it, vi } from "vitest";
import { BAKER_ES_A1_REPLY, npcContextFixture } from "../../../shared/src/npc/fixtures";
import type { NpcTurnResult } from "../ai/templates";
import { type NpcAi, NpcConversation, type NpcRoom } from "./npcConversation";

/** A fake room: records what the client sends and lets the test answer as the server. */
function fakeRoom() {
  const handlers = new Map<string, Set<(m: unknown) => void>>();
  const sent: { type: string; payload: unknown }[] = [];
  const room: NpcRoom = {
    send: (type, payload) => void sent.push({ type, payload }),
    onMessage: <T,>(type: string, handler: (m: T) => void) => {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (m: unknown) => void);
      handlers.set(type, set);
      return () => set.delete(handler as (m: unknown) => void);
    },
  };
  const emit = (type: string, message: unknown) => {
    for (const h of [...(handlers.get(type) ?? [])]) h(message);
  };
  return { room, sent, emit };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const player = { name: "Lia", animal: "fox", apartmentId: "3B" };
const ctx = npcContextFixture({ lang: "es", playerLevel: "A1" });
const parsed = parseNpcTurnReply(JSON.stringify(BAKER_ES_A1_REPLY));
const okTurn: NpcTurnResult = parsed.ok ? { ok: true, reply: parsed.reply, attempts: 1 } : (undefined as never);

function ai(results: NpcTurnResult[]): NpcAi {
  let i = 0;
  return {
    run: vi.fn(async () => results[i++] ?? results[results.length - 1]!),
    canned: (kind) => ({ text: kind, translation: "", tokens: [{ surface: kind, gloss: "" }] }),
  };
}

async function started(model: NpcAi) {
  const f = fakeRoom();
  const pending = NpcConversation.start(f.room, model, player, "baker");
  expect(f.sent).toEqual([{ type: ClientMessage.NpcStart, payload: { npcId: "baker" } }]);
  f.emit(ServerMessage.NpcContext, ctx);
  return { ...f, conversation: await pending };
}

describe("NpcConversation", () => {
  it("sends the model's actions with the server's turn id and settles the bread offer", async () => {
    const { conversation, sent, emit } = await started(ai([okTurn]));
    const said = conversation.say("Quiero pan", "typed");
    await flush();
    const reply = sent.at(-1)!;
    expect(reply.type).toBe(ClientMessage.NpcReply);
    expect(reply.payload).toEqual({ conversationId: ctx.conversationId, turnId: ctx.turnId, actions: [{ type: "offer", itemId: "bread", qty: 1, price: 1 }] } satisfies NpcReplyMessage);
    const applied: NpcAppliedMessage = {
      conversationId: ctx.conversationId,
      turnId: ctx.turnId,
      accepted: [{ type: "offer", itemId: "bread", qty: 1, unitPrice: 5, price: 5 }],
      rejected: [],
      trades: [{ tradeId: "trade-1", kind: "offer", itemId: "bread", qty: 1, unitPrice: 5, price: 5 }],
      nextTurnId: "turn-2",
      ended: false,
      hearts: 0,
      stock: ctx.stock,
      inventory: [],
    };
    emit(ServerMessage.NpcApplied, applied);
    const result = await said;
    expect(result.ok && result.applied.trades[0]!.price).toBe(5);

    const confirmed = conversation.confirm("trade-1", true);
    expect(sent.at(-1)).toEqual({ type: ClientMessage.NpcConfirm, payload: { conversationId: ctx.conversationId, tradeId: "trade-1", accept: true } });
    const trade: NpcTradeMessage = { tradeId: "trade-1", ok: true, coins: 45, inventory: [{ itemId: "bread", qty: 1 }] };
    emit(ServerMessage.NpcTrade, trade);
    expect(await confirmed).toEqual(trade);
    expect(conversation.context.coins).toBe(45);

    // The next turn carries the new id and the history.
    void conversation.say("Gracias", "suggested");
    await flush();
    expect((sent.at(-1)!.payload as NpcReplyMessage).turnId).toBe("turn-2");
  });

  it("shows the canned retry line once, then says the NPC is busy", async () => {
    const failed: NpcTurnResult = { ok: false, reason: "failed", fallback: { text: "retry", translation: "", tokens: [{ surface: "retry", gloss: "" }] } };
    const { conversation, sent } = await started(ai([failed]));
    expect(await conversation.say("pan", "typed")).toMatchObject({ ok: false, retry: true, line: { text: "retry" } });
    expect(await conversation.say("pan", "typed")).toMatchObject({ ok: false, retry: false, line: { text: "busy" } });
    expect(sent.filter((s) => s.type === ClientMessage.NpcReply)).toHaveLength(0);
  });

  it("stops talking when the server issues no more turns, and refusals come back as errors", async () => {
    const { conversation, emit } = await started(ai([okTurn]));
    const said = conversation.say("Adiós", "typed");
    await flush();
    emit(ServerMessage.NpcApplied, { conversationId: ctx.conversationId, turnId: ctx.turnId, accepted: [{ type: "endConversation" }], rejected: [], trades: [], nextTurnId: null, ended: true, hearts: 0, stock: [], inventory: [] });
    await said;
    expect(conversation.canTalk).toBe(false);
    expect(await conversation.say("¿Hola?", "typed")).toMatchObject({ ok: false, reason: "ended" });

    const f = fakeRoom();
    const refused = NpcConversation.start(f.room, ai([okTurn]), player, "baker");
    f.emit(ServerMessage.NpcRefused, { reason: "daily_limit", npcId: "baker" });
    await expect(refused).rejects.toMatchObject({ reason: "daily_limit" });
  });
});
