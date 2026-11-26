import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  adjustedUnitPrice,
  ClientMessage,
  type InventoryMoveMessage,
  type InventoryStateMessage,
  NPC_POSTS,
  type NpcActionInput,
  type NpcAppliedMessage,
  type NpcContextMessage,
  type NpcId,
  type NpcRefusedMessage,
  type NpcTradeMessage,
  RoomName,
  ServerMessage,
  type SlotEntry,
  type SpacePoint,
  type UserProfile,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryNpcStore, type MemoryNpcStore, type MemoryPlayer } from "../npc/npcStore";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer } from "../server";

/**
 * Build plan M26 acceptance over the real Colyseus SDK, with two clients per server: buying at the
 * bakery, selling forage at the farm, haggling at the general store, coins that never go negative,
 * and forged client messages (made-up prices and items, replayed turn and trade ids, someone else's
 * trade, selling what the player does not hold, bad inventory moves). The model is not involved:
 * each test sends the actions a (possibly forged) client would. Auth is mocked; the store is the
 * in-memory one.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const profile = (name: string, targetLang: string): UserProfile => ({
  name,
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: name === "Kenji" ? "2C" : "3A",
  nativeLang: "en",
  targetLangs: [targetLang],
  style: "european",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});
const PROFILES = { kenji: profile("Kenji", "ja"), lia: profile("Lia", "es") };

let server: GameServer | null = null;
let rooms: Room[] = [];

afterEach(async () => {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Every message of one type, in arrival order, with a way to wait for the next one. */
class Inbox<T> {
  readonly all: T[] = [];
  private seen = 0;
  constructor(room: Room, type: string) {
    room.onMessage(type, (m: T) => this.all.push(m));
  }
  async next(what = "a message", ms = 3000): Promise<T> {
    const end = Date.now() + ms;
    while (this.all.length <= this.seen) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(10);
    }
    return this.all[this.seen++]!;
  }
  /** Skips what already arrived. */
  drain(): void {
    this.seen = this.all.length;
  }
}

interface Player {
  room: Room;
  context: Inbox<NpcContextMessage>;
  applied: Inbox<NpcAppliedMessage>;
  trade: Inbox<NpcTradeMessage>;
  refused: Inbox<NpcRefusedMessage>;
  inventory: Inbox<InventoryStateMessage>;
}

async function serve(store: MemoryNpcStore, spawn: SpacePoint): Promise<string> {
  server = createGameServer({ verifier: fakeVerifier, profiles: createMemoryProfileStore(PROFILES), npcStore: store, town: { spawn } });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function join(url: string, uid: keyof typeof PROFILES): Promise<Player> {
  const room = await new Client(url).joinOrCreate(RoomName.Town, { idToken: `valid:${uid}` });
  rooms.push(room);
  return {
    room,
    context: new Inbox(room, ServerMessage.NpcContext),
    applied: new Inbox(room, ServerMessage.NpcApplied),
    trade: new Inbox(room, ServerMessage.NpcTrade),
    refused: new Inbox(room, ServerMessage.NpcRefused),
    inventory: new Inbox(room, ServerMessage.InventoryState),
  };
}

const at = (npcId: NpcId): SpacePoint => ({ space: NPC_POSTS[npcId].space, pos: NPC_POSTS[npcId].talkSpot, heading: Math.PI });

const wallet = (coins: number, slots: SlotEntry[] = [], hearts: MemoryPlayer["hearts"] = {}): MemoryPlayer => ({ level: "A2", coins, hearts, slots });

async function talk(p: Player, npcId: NpcId): Promise<NpcContextMessage> {
  p.room.send(ClientMessage.NpcStart, { npcId });
  return p.context.next(`npc:context from ${npcId}`);
}

async function reply(p: Player, ctx: NpcContextMessage, turnId: string, actions: NpcActionInput[]): Promise<NpcAppliedMessage> {
  p.room.send(ClientMessage.NpcReply, { conversationId: ctx.conversationId, turnId, actions });
  return p.applied.next("npc:applied");
}

async function confirm(p: Player, ctx: NpcContextMessage, tradeId: string, accept = true): Promise<NpcTradeMessage> {
  p.room.send(ClientMessage.NpcConfirm, { conversationId: ctx.conversationId, tradeId, accept });
  return p.trade.next("npc:trade");
}

describe("M26 · inventory, economy and shops (TownRoom, two clients)", () => {
  it("buys bread at the bakery: server prices, coins and slots pushed, forged replays refused", async () => {
    const store = createMemoryNpcStore({ "kenji/ja": wallet(12), "lia/es": wallet(30) });
    const url = await serve(store, at("baker"));
    const kenji = await join(url, "kenji");
    const lia = await join(url, "lia");

    // The join pushes each player's own coins and slots.
    expect(await kenji.inventory.next("Kenji's inventory on join")).toEqual({ lang: "ja", coins: 12, slots: [] });
    expect(await lia.inventory.next("Lia's inventory on join")).toEqual({ lang: "es", coins: 30, slots: [] });

    const ctx = await talk(kenji, "baker");
    expect(ctx.stock).toContainEqual({ itemId: "bread", price: 5 });
    // A forged price of 0 coins and a made-up item: the server prices the bread itself and drops the rest.
    const applied = await reply(kenji, ctx, ctx.turnId, [
      { type: "offer", itemId: "bread", qty: 2, price: 0 },
      { type: "offer", itemId: "golden_goose", price: 1 },
    ]);
    expect(applied.trades).toEqual([expect.objectContaining({ kind: "offer", itemId: "bread", qty: 2, unitPrice: 5, price: 10 })]);
    expect(applied.rejected).toEqual([{ type: "offer", reason: "unknown_item" }]);
    const tradeId = applied.trades[0]!.tradeId;

    // Lia cannot settle Kenji's trade, even with his ids.
    lia.room.send(ClientMessage.NpcConfirm, { conversationId: ctx.conversationId, tradeId, accept: true });
    expect(await lia.refused.next("Lia's refusal")).toMatchObject({ reason: "no_conversation" });

    expect(await confirm(kenji, ctx, tradeId)).toMatchObject({ ok: true, coins: 2, inventory: [{ itemId: "bread", qty: 2 }] });
    expect(await kenji.inventory.next("Kenji's inventory after the trade")).toEqual({ lang: "ja", coins: 2, slots: [{ slot: 0, itemId: "bread", qty: 2 }] });

    // The same trade id again: nothing happens.
    expect(await confirm(kenji, ctx, tradeId)).toMatchObject({ ok: false, reason: "unknown_trade", coins: 2 });
    // The same turn id again: refused.
    kenji.room.send(ClientMessage.NpcReply, { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: [{ type: "offer", itemId: "bread" }] });
    expect(await kenji.refused.next("the replayed turn")).toMatchObject({ reason: "unknown_turn" });
    // A trade id the server never issued.
    expect(await confirm(kenji, ctx, "made-up-trade")).toMatchObject({ ok: false, reason: "unknown_trade", coins: 2 });

    // Coins never go negative: 2 coins cannot buy a croissant (4).
    const again = await reply(kenji, ctx, applied.nextTurnId!, [{ type: "offer", itemId: "croissant", price: 1 }]);
    expect(await confirm(kenji, ctx, again.trades[0]!.tradeId)).toMatchObject({ ok: false, reason: "insufficient_coins", coins: 2 });

    expect(store.players.get("kenji/ja")).toMatchObject({ coins: 2, slots: [{ slot: 0, itemId: "bread", qty: 2 }] });
    // Lia's records are untouched.
    expect(store.players.get("lia/es")).toMatchObject({ coins: 30, slots: [] });
    expect(lia.inventory.all).toHaveLength(1);
  });

  it("sells forage at the farm at the server's price, and only what the player holds", async () => {
    const forage: SlotEntry[] = [
      { slot: 0, itemId: "chanterelle", qty: 2 },
      { slot: 1, itemId: "daisy", qty: 3 },
    ];
    const store = createMemoryNpcStore({ "lia/es": wallet(0, forage), "kenji/ja": wallet(5, [{ slot: 0, itemId: "daisy", qty: 9 }]) });
    const url = await serve(store, at("farmer"));
    const lia = await join(url, "lia");
    const kenji = await join(url, "kenji");
    await lia.inventory.next("Lia's inventory on join");
    await kenji.inventory.next("Kenji's inventory on join");

    const ctx = await talk(lia, "farmer");
    expect(ctx.buys).toEqual(expect.arrayContaining([{ itemId: "chanterelle", price: 8 }, { itemId: "daisy", price: 2 }]));
    const applied = await reply(lia, ctx, ctx.turnId, [
      { type: "buy", itemId: "chanterelle", qty: 2, price: 999 },
      // More daisies than she has (Kenji's 9 do not count), something the farm does not buy, and a made-up item.
      { type: "buy", itemId: "daisy", qty: 5 },
      { type: "buy", itemId: "smooth_pebble" },
      { type: "buy", itemId: "unicorn_horn" },
    ]);
    expect(applied.trades).toEqual([expect.objectContaining({ kind: "buy", itemId: "chanterelle", qty: 2, unitPrice: 8, price: 16 })]);
    expect(applied.rejected.map((r) => r.reason).sort()).toEqual(["not_bought_here", "not_owned", "unknown_item"]);
    expect(await confirm(lia, ctx, applied.trades[0]!.tradeId)).toMatchObject({ ok: true, coins: 16 });
    expect(await lia.inventory.next("Lia's inventory after the sale")).toEqual({ lang: "es", coins: 16, slots: [{ slot: 1, itemId: "daisy", qty: 3 }] });

    // Two offers to sell the same three daisies: only the first settles.
    const first = await reply(lia, ctx, applied.nextTurnId!, [{ type: "buy", itemId: "daisy", qty: 3 }]);
    const second = await reply(lia, ctx, first.nextTurnId!, [{ type: "buy", itemId: "daisy", qty: 3 }]);
    expect(await confirm(lia, ctx, first.trades[0]!.tradeId)).toMatchObject({ ok: true, coins: 22, inventory: [] });
    expect(await confirm(lia, ctx, second.trades[0]!.tradeId)).toMatchObject({ ok: false, reason: "not_owned", coins: 22 });

    expect(store.players.get("lia/es")).toMatchObject({ coins: 22, slots: [] });
    expect(store.players.get("kenji/ja")).toMatchObject({ coins: 5, slots: [{ slot: 0, itemId: "daisy", qty: 9 }] });
  });

  it("haggles at the general store: an inflated opening, a clamped discount scaled by friendship", async () => {
    const store = createMemoryNpcStore({ "kenji/ja": wallet(40, [], { shopkeeper: 0 }), "lia/es": wallet(40, [], { shopkeeper: 10 }) });
    const url = await serve(store, at("shopkeeper"));
    const kenji = await join(url, "kenji");
    const lia = await join(url, "lia");

    // A stranger: the rod opens at 55 (+10 %); asking for −90 % gives −15 % (half the −30 % cap at 0 hearts).
    const k = await talk(kenji, "shopkeeper");
    expect(k.stock).toContainEqual({ itemId: "fishing_rod", price: 55 });
    const kTurn = await reply(kenji, k, k.turnId, [
      { type: "priceAdjustment", itemId: "fishing_rod", pct: -90 },
      { type: "offer", itemId: "fishing_rod", price: 1 },
      // A forged mark-up is clamped to +10 % (no more than the opening).
      { type: "priceAdjustment", itemId: "bug_net", pct: 500 },
      { type: "offer", itemId: "bug_net" },
    ]);
    expect(kTurn.accepted).toEqual(expect.arrayContaining([{ type: "priceAdjustment", itemId: "fishing_rod", pct: -15 }, { type: "priceAdjustment", itemId: "bug_net", pct: 10 }]));
    const rod = kTurn.trades.find((t) => t.itemId === "fishing_rod")!;
    expect(rod.price).toBe(adjustedUnitPrice("fishing_rod", -15));
    expect(kTurn.trades.find((t) => t.itemId === "bug_net")!.price).toBe(33);
    expect(kTurn.stock).toContainEqual({ itemId: "fishing_rod", price: rod.price });
    // 43 coins is more than his 40: refused, and his coins stay where they were.
    expect(await confirm(kenji, k, rod.tradeId)).toMatchObject({ ok: false, reason: "insufficient_coins", coins: 40 });
    // A second haggle on the rod in the same conversation is refused.
    const kAgain = await reply(kenji, k, kTurn.nextTurnId!, [{ type: "priceAdjustment", itemId: "fishing_rod", pct: -30 }, { type: "offer", itemId: "fishing_rod" }]);
    expect(kAgain.rejected).toEqual([{ type: "priceAdjustment", reason: "already_adjusted" }]);
    expect(kAgain.trades[0]!.price).toBe(rod.price);

    // A close friend gets the full −30 %: 35 coins, which she can pay.
    const l = await talk(lia, "shopkeeper");
    const lTurn = await reply(lia, l, l.turnId, [{ type: "priceAdjustment", itemId: "fishing_rod", pct: -30 }, { type: "offer", itemId: "fishing_rod", price: 0 }]);
    expect(lTurn.trades[0]).toMatchObject({ itemId: "fishing_rod", price: 35 });
    await lia.inventory.next("Lia's inventory on join");
    expect(await confirm(lia, l, lTurn.trades[0]!.tradeId)).toMatchObject({ ok: true, coins: 5 });
    expect(await lia.inventory.next("Lia's inventory after buying the rod")).toEqual({ lang: "es", coins: 5, slots: [{ slot: 0, itemId: "fishing_rod", qty: 1 }] });

    // Selling back to the Shopkeeper: the lowball 30 %.
    const sale = await reply(lia, l, lTurn.nextTurnId!, [{ type: "buy", itemId: "fishing_rod", price: 50 }]);
    expect(sale.trades[0]).toMatchObject({ kind: "buy", price: 15 });

    expect(store.players.get("kenji/ja")!.coins).toBe(40);
    expect(store.players.get("lia/es")!.coins).toBe(5);
  });

  it("moves stacks between the bag and the hotbar, and refuses forged moves", async () => {
    const store = createMemoryNpcStore({
      "kenji/ja": wallet(9, [
        { slot: 0, itemId: "bread", qty: 2 },
        { slot: 1, itemId: "daisy", qty: 4 },
      ]),
      "lia/es": wallet(1, [{ slot: 0, itemId: "tea", qty: 1 }]),
    });
    const url = await serve(store, at("baker"));
    const kenji = await join(url, "kenji");
    const lia = await join(url, "lia");
    await kenji.inventory.next("Kenji's inventory on join");
    await lia.inventory.next("Lia's inventory on join");
    const move = (p: Player, m: InventoryMoveMessage) => p.room.send(ClientMessage.InventoryMove, m);

    move(kenji, { from: 0, to: 24, moveId: 1 });
    expect(await kenji.inventory.next("the move to the hotbar")).toEqual({
      lang: "ja",
      coins: 9,
      moveId: 1,
      slots: [
        { slot: 1, itemId: "daisy", qty: 4 },
        { slot: 24, itemId: "bread", qty: 2 },
      ],
    });
    // Swapping the hotbar slot with the daisies.
    move(kenji, { from: 1, to: 24, moveId: 2 });
    expect((await kenji.inventory.next("the swap")).slots).toEqual([
      { slot: 1, itemId: "bread", qty: 2 },
      { slot: 24, itemId: "daisy", qty: 4 },
    ]);

    // Forged: out-of-range slots and extra fields are dropped by the schema (no answer at all) …
    move(kenji, { from: 0, to: 30, moveId: 3 });
    kenji.room.send(ClientMessage.InventoryMove, { from: 1, to: 2, moveId: 4, qty: 99 });
    kenji.room.send(ClientMessage.InventoryMove, { from: 1, to: 2, moveId: 5, itemId: "cake" });
    // … and an empty source slot is refused with the state unchanged.
    move(kenji, { from: 7, to: 2, moveId: 6 });
    const refused = await kenji.inventory.next("the refused move");
    expect(refused).toMatchObject({ moveId: 6, refused: "empty_slot", coins: 9 });
    expect(refused.slots).toEqual([
      { slot: 1, itemId: "bread", qty: 2 },
      { slot: 24, itemId: "daisy", qty: 4 },
    ]);

    // Kenji's moves never touch Lia's bag.
    expect(store.players.get("lia/es")!.slots).toEqual([{ slot: 0, itemId: "tea", qty: 1 }]);
    expect(lia.inventory.all).toHaveLength(1);
  });

  it("rate-limits moves and answers with the unchanged state", async () => {
    const store = createMemoryNpcStore({ "kenji/ja": wallet(0, [{ slot: 0, itemId: "egg", qty: 1 }]) });
    const url = await serve(store, at("baker"));
    const kenji = await join(url, "kenji");
    await kenji.inventory.next("the inventory on join");
    for (let i = 0; i < 12; i++) kenji.room.send(ClientMessage.InventoryMove, { from: i % 2 === 0 ? 0 : 1, to: i % 2 === 0 ? 1 : 0, moveId: i });
    const answers: InventoryStateMessage[] = [];
    for (let i = 0; i < 12; i++) answers.push(await kenji.inventory.next(`answer ${i}`));
    expect(answers.map((a) => a.moveId)).toEqual([...Array(12).keys()]);
    expect(answers.filter((a) => a.refused === "rate").length).toBeGreaterThan(0);
    // Whatever was refused, the egg is still there exactly once.
    const slots = store.players.get("kenji/ja")!.slots;
    expect(slots.reduce((n, s) => n + s.qty, 0)).toBe(1);
  });
});
