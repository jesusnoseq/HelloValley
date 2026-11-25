import { NpcActionListSchema, type NpcActionInput, parseNpcTurnReply } from "@hellovalley/shared";
import { describe, expect, it } from "vitest";
import { BAKER_ES_A1_REPLY, BAKER_JA_B2_REPLY } from "../../../shared/src/npc/fixtures";
import { NPC_REPLY_RATE, NPC_TURNS_PER_CONVERSATION, NpcDialogueService } from "./dialogue";
import { createMemoryNpcStore, type MemoryPlayer, type NpcStore } from "./npcStore";

/**
 * The server half of NPC turns (build plan M21): context and turn ids, validation of the model's
 * proposed actions with the shared rules, server-side prices, confirmed trades, and the limits.
 */

const T0 = Date.UTC(2026, 10, 25, 12, 0, 0);
const player = (over: Partial<MemoryPlayer> = {}): MemoryPlayer => ({ level: "A1", coins: 50, hearts: {}, slots: [], ...over });
const actions = (list: readonly unknown[]) => NpcActionListSchema.parse(list);

function setup(players: Record<string, MemoryPlayer> = { "lia/es": player(), "kenji/ja": player({ level: "B2" }) }) {
  const store = createMemoryNpcStore(players);
  return { store, npc: new NpcDialogueService(store) };
}

async function startOk(npc: NpcDialogueService, uid: string, lang: string, npcId: "baker" | "shopkeeper" = "baker", now = T0) {
  const r = await npc.start({ uid, npcId, lang, nativeLang: "en" }, now);
  if (!r.ok) throw new Error(`start refused: ${r.reason}`);
  return r.context;
}

describe("NpcDialogueService", () => {
  it("talks to the Baker in Spanish at A1 and buys bread through an offer (acceptance)", async () => {
    const { store, npc } = setup();
    const ctx = await startOk(npc, "lia", "es");
    expect(ctx).toMatchObject({ npcId: "baker", lang: "es", playerLevel: "A1", effectiveLevel: "A1", simplified: true, coins: 50, hearts: 0.25, contact: { greeting: 0.25, decay: 0 }, lastSeen: null });
    expect(ctx.stock).toContainEqual({ itemId: "bread", price: 5 });

    // The client's validated reply proposes bread at 1 coin; the server charges its own 5.
    const reply = parseNpcTurnReply(JSON.stringify(BAKER_ES_A1_REPLY));
    if (!reply.ok) throw new Error(reply.error);
    const r = await npc.reply("lia", { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: reply.reply.actions }, T0 + 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.applied.trades).toEqual([expect.objectContaining({ kind: "offer", itemId: "bread", qty: 1, unitPrice: 5, price: 5 })]);
    expect(r.applied.nextTurnId).toBeTruthy();
    expect(store.players.get("lia/es")!.coins).toBe(50); // nothing happens before the player confirms

    const trade = await npc.confirm("lia", { conversationId: ctx.conversationId, tradeId: r.applied.trades[0]!.tradeId, accept: true }, T0 + 2000);
    expect(trade).toEqual({ tradeId: r.applied.trades[0]!.tradeId, ok: true, coins: 45, inventory: [{ itemId: "bread", qty: 1 }] });
    expect(store.players.get("lia/es")).toMatchObject({ coins: 45, slots: [{ slot: 0, itemId: "bread", qty: 1 }] });
    // A trade settles once.
    const again = await npc.confirm("lia", { conversationId: ctx.conversationId, tradeId: r.applied.trades[0]!.tradeId, accept: true }, T0 + 3000);
    expect(again).toMatchObject({ ok: false, reason: "unknown_trade", coins: 45 });
  });

  it("talks to the Baker in Japanese at B2 (effective B1) and applies the friendship point", async () => {
    const { store, npc } = setup();
    const ctx = await startOk(npc, "kenji", "ja");
    expect(ctx).toMatchObject({ lang: "ja", playerLevel: "B2", effectiveLevel: "B1", simplified: false });
    const reply = parseNpcTurnReply(JSON.stringify(BAKER_JA_B2_REPLY));
    if (!reply.ok) throw new Error(reply.error);
    const r = await npc.reply("kenji", { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: reply.reply.actions }, T0 + 1000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.applied.accepted.map((a) => a.type)).toEqual(["offer", "friendshipDelta"]);
    // The daily greeting (+¼) at npc:start, then the friendship point (+½).
    expect(r.applied.hearts).toBe(0.75);
    expect(store.players.get("kenji/ja")!.hearts.baker).toBe(0.75);
  });

  it("rejects forged and out-of-rule actions without changing anything", async () => {
    const { store, npc } = setup();
    const ctx = await startOk(npc, "lia", "es");
    const forged: NpcActionInput[] = [
      { type: "give", itemId: "cake" },
      { type: "priceAdjustment", pct: -100 },
      { type: "teachRecipe", recipeId: "berry_tart" },
      { type: "completeQuest", questId: "free_money" },
      { type: "offer", itemId: "fishing_rod", price: 0 },
    ];
    const r = await npc.reply("lia", { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: actions(forged) }, T0 + 1000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.applied.accepted).toEqual([]);
    expect(r.applied.rejected.map((x) => x.reason).sort()).toEqual(["conditions_not_met", "hearts_required", "not_in_gift_table", "not_shopkeeper", "not_sold_here"]);
    expect(store.players.get("lia/es")).toMatchObject({ coins: 50, slots: [], hearts: { baker: 0.25 } });
  });

  it("does not let the player pay with coins they do not have", async () => {
    const { npc } = setup({ "lia/es": player({ coins: 3 }) });
    const ctx = await startOk(npc, "lia", "es");
    const r = await npc.reply("lia", { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: actions([{ type: "offer", itemId: "cake" }]) }, T0 + 1000);
    if (!r.ok) throw new Error(r.reason);
    const trade = await npc.confirm("lia", { conversationId: ctx.conversationId, tradeId: r.applied.trades[0]!.tradeId, accept: true }, T0 + 2000);
    expect(trade).toMatchObject({ ok: false, reason: "insufficient_coins", coins: 3 });
  });

  it("haggles at the Shopkeeper and keeps the haggled price for the conversation", async () => {
    const { npc } = setup({ "lia/es": player({ hearts: { shopkeeper: 10 } }) });
    const ctx = await startOk(npc, "lia", "es", "shopkeeper");
    const r = await npc.reply("lia", { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: actions([{ type: "priceAdjustment", itemId: "fishing_rod", pct: -50 }]) }, T0 + 1000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.applied.accepted).toEqual([{ type: "priceAdjustment", itemId: "fishing_rod", pct: -30 }]);
    expect(r.applied.stock).toContainEqual({ itemId: "fishing_rod", price: 35 });
    const offer = await npc.reply("lia", { conversationId: ctx.conversationId, turnId: r.applied.nextTurnId!, actions: actions([{ type: "offer", itemId: "fishing_rod", price: 1 }]) }, T0 + 5000);
    expect(offer.ok && offer.applied.trades[0]?.price).toBe(35);
  });

  it("accepts each turn id once, in order", async () => {
    const { npc } = setup();
    const ctx = await startOk(npc, "lia", "es");
    const msg = { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: [] };
    const [a, b] = await Promise.all([npc.reply("lia", msg, T0 + 1000), npc.reply("lia", msg, T0 + 1000)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await npc.reply("lia", { ...msg, turnId: "made-up" }, T0 + 9000)).toEqual({ ok: false, reason: "unknown_turn" });
    expect(await npc.reply("lia", { ...msg, conversationId: "other" }, T0 + 9000)).toEqual({ ok: false, reason: "no_conversation" });
    expect(await npc.reply("bob", msg, T0 + 9000)).toEqual({ ok: false, reason: "no_conversation" });
  });

  it("rate-limits replies and caps the turns per conversation", async () => {
    const { npc } = setup();
    const ctx = await startOk(npc, "lia", "es");
    let turnId: string | null = ctx.turnId;
    let now = T0;
    for (let i = 0; i < NPC_REPLY_RATE.burst; i++) {
      const r = await npc.reply("lia", { conversationId: ctx.conversationId, turnId: turnId!, actions: [] }, now);
      if (!r.ok) throw new Error(r.reason);
      turnId = r.applied.nextTurnId;
    }
    // Too fast: refused, but the turn id stays valid.
    expect(await npc.reply("lia", { conversationId: ctx.conversationId, turnId: turnId!, actions: [] }, now)).toEqual({ ok: false, reason: "rate" });
    let used = NPC_REPLY_RATE.burst;
    while (turnId) {
      now += 10_000;
      const r = await npc.reply("lia", { conversationId: ctx.conversationId, turnId, actions: [] }, now);
      if (!r.ok) throw new Error(r.reason);
      used++;
      turnId = r.applied.nextTurnId;
    }
    expect(used).toBe(NPC_TURNS_PER_CONVERSATION);
  });

  it("ends the conversation on endConversation but still settles its trades", async () => {
    const { npc } = setup();
    const ctx = await startOk(npc, "lia", "es");
    const r = await npc.reply("lia", { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: actions([{ type: "offer", itemId: "bread" }, { type: "endConversation" }]) }, T0 + 1000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.applied).toMatchObject({ ended: true, nextTurnId: null });
    const trade = await npc.confirm("lia", { conversationId: ctx.conversationId, tradeId: r.applied.trades[0]!.tradeId, accept: false }, T0 + 2000);
    expect(trade).toMatchObject({ ok: false, reason: "declined", coins: 50 });
    npc.end("lia", ctx.conversationId);
    expect(await npc.confirm("lia", { conversationId: ctx.conversationId, tradeId: "x", accept: true })).toEqual({ ok: false, reason: "no_conversation" });
  });

  it("gives the turn back when the store is down", async () => {
    const memory = createMemoryNpcStore({ "lia/es": player() });
    let down = false;
    const store: NpcStore = {
      load: (...args) => (down ? Promise.reject(new Error("offline")) : memory.load(...args)),
      apply: (...args) => memory.apply(...args),
      contact: (...args) => memory.contact(...args),
      gift: (...args) => memory.gift(...args),
      remember: (...args) => memory.remember(...args),
    };
    const npc = new NpcDialogueService(store);
    const ctx = await startOk(npc, "lia", "es");
    down = true;
    const msg = { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: [] };
    expect(await npc.reply("lia", msg, T0 + 1000)).toEqual({ ok: false, reason: "unavailable" });
    down = false;
    expect((await npc.reply("lia", msg, T0 + 5000)).ok).toBe(true);
    expect(await npc.start({ uid: "nobody", npcId: "baker", lang: "es", nativeLang: "en" })).toEqual({ ok: false, reason: "unavailable" });
  });
});
