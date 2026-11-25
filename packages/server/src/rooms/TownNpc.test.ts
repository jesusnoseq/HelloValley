import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ClientMessage,
  NPC_POSTS,
  type NpcAppliedMessage,
  type NpcContextMessage,
  type NpcGiftedMessage,
  type NpcRememberedMessage,
  type NpcRefusedMessage,
  type NpcTradeMessage,
  PlayerController,
  type PlayerMoveMessage,
  RoomName,
  ServerMessage,
  type SpacePoint,
  type TownPlayerView,
  type UserProfile,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { BAKER_JA_B2_REPLY } from "../../../shared/src/npc/fixtures";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryNpcStore, type MemoryNpcStore } from "../npc/npcStore";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer } from "../server";

/**
 * NPC conversations over the TownRoom with the real Colyseus SDK (build plan M21, architecture
 * §5.3): npc:start → npc:context, the client's (here: canned) model reply as npc:reply →
 * npc:applied with the server's prices, npc:confirm → npc:trade. Auth is mocked.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const kenji: UserProfile = {
  name: "Kenji",
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "2C",
  nativeLang: "en",
  targetLangs: ["ja"],
  style: "japanese",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
};

let server: GameServer | null = null;
let rooms: Room[] = [];

afterEach(async () => {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
});

const next = <T>(room: Room, type: string) => new Promise<T>((resolve) => room.onMessage(type, (m: T) => resolve(m)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In front of the Baker's counter (build plan M23: npc:start needs the player next to the NPC). */
const AT_BAKER: SpacePoint = { space: "bakery", pos: NPC_POSTS.baker.talkSpot, heading: Math.PI };

async function until(check: () => boolean, what: string, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

const self = (room: Room): TownPlayerView | undefined => (room.state as { players?: Map<string, TownPlayerView> }).players?.get(room.sessionId);

async function start(store: MemoryNpcStore, spawn: SpacePoint = AT_BAKER): Promise<Room> {
  server = createGameServer({ verifier: fakeVerifier, profiles: createMemoryProfileStore({ kenji }), npcStore: store, town: { spawn } });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  const room = await new Client(`http://127.0.0.1:${port}`).joinOrCreate(RoomName.Town, { idToken: "valid:kenji" });
  rooms.push(room);
  return room;
}

describe("TownRoom NPC conversations", () => {
  it("buys bread from the Baker in Japanese through an offer", async () => {
    const store = createMemoryNpcStore({ "kenji/ja": { level: "B2", coins: 20, hearts: {}, slots: [] } });
    const room = await start(store);

    const contextP = next<NpcContextMessage>(room, ServerMessage.NpcContext);
    room.send(ClientMessage.NpcStart, { npcId: "baker" });
    const ctx = await contextP;
    expect(ctx).toMatchObject({ npcId: "baker", lang: "ja", nativeLang: "en", effectiveLevel: "B1", coins: 20 });

    const appliedP = next<NpcAppliedMessage>(room, ServerMessage.NpcApplied);
    room.send(ClientMessage.NpcReply, { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: BAKER_JA_B2_REPLY.actions });
    const applied = await appliedP;
    expect(applied.trades).toEqual([expect.objectContaining({ kind: "offer", itemId: "bread", price: 5 })]);

    const tradeP = next<NpcTradeMessage>(room, ServerMessage.NpcTrade);
    room.send(ClientMessage.NpcConfirm, { conversationId: ctx.conversationId, tradeId: applied.trades[0]!.tradeId, accept: true });
    expect(await tradeP).toMatchObject({ ok: true, coins: 15, inventory: [{ itemId: "bread", qty: 1 }] });
    expect(store.players.get("kenji/ja")!.coins).toBe(15);

    // The same turn id again is refused.
    const refusedP = next<NpcRefusedMessage>(room, ServerMessage.NpcRefused);
    room.send(ClientMessage.NpcReply, { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: BAKER_JA_B2_REPLY.actions });
    expect(await refusedP).toMatchObject({ reason: "unknown_turn" });
  });

  it("refuses to start away from the NPC", async () => {
    const store = createMemoryNpcStore({ "kenji/ja": { level: "B2", coins: 20, hearts: {}, slots: [] } });
    const room = await start(store, { space: "apartment", pos: [1, 1], heading: 0 });
    const refusedP = next<NpcRefusedMessage>(room, ServerMessage.NpcRefused);
    room.send(ClientMessage.NpcStart, { npcId: "baker" });
    expect(await refusedP).toMatchObject({ reason: "too_far", npcId: "baker" });
  });

  it("shows bystanders who is chatting, until goodbye or walking away", async () => {
    const store = createMemoryNpcStore({ "kenji/ja": { level: "B2", coins: 20, hearts: {}, slots: [] } });
    const room = await start(store);
    await until(() => self(room)?.talkingTo === "", "the synced state");

    const contextP = next<NpcContextMessage>(room, ServerMessage.NpcContext);
    room.send(ClientMessage.NpcStart, { npcId: "baker" });
    const ctx = await contextP;
    await until(() => self(room)?.talkingTo === "baker", "talkingTo = baker");
    room.send(ClientMessage.NpcEnd, { conversationId: ctx.conversationId });
    await until(() => self(room)?.talkingTo === "", "talkingTo cleared on npc:end");

    // Again, then walk to the far corner of the bakery: the server ends the conversation.
    room.send(ClientMessage.NpcStart, { npcId: "baker" });
    await until(() => self(room)?.talkingTo === "baker", "talkingTo = baker again");
    const walker = new PlayerController(AT_BAKER);
    expect(walker.clickTo([0.4, 4.5])).toBe(true);
    let seq = 0;
    let last = performance.now();
    while (walker.waypoints) {
      await sleep(50);
      const now = performance.now();
      walker.update((now - last) / 1000);
      last = now;
      const { space, pos, heading, motion } = walker.state;
      const move: PlayerMoveMessage = { seq: ++seq, epoch: 0, space, x: pos[0], z: pos[1], heading, motion };
      room.send(ClientMessage.PlayerMove, move);
    }
    await until(() => self(room)?.talkingTo === "", "talkingTo cleared on walking away");
  });
});

describe("TownRoom NPC memory and gifts (build plan M24)", () => {
  it("stores the compaction after npc:end and takes a gift", async () => {
    const store = createMemoryNpcStore({ "kenji/ja": { level: "B2", coins: 20, hearts: {}, slots: [{ slot: 0, itemId: "butter", qty: 1 }] } });
    const room = await start(store);
    const contextP = next<NpcContextMessage>(room, ServerMessage.NpcContext);
    room.send(ClientMessage.NpcStart, { npcId: "baker" });
    const ctx = await contextP;
    expect(ctx).toMatchObject({ hearts: 0.25, contact: { greeting: 0.25 }, giftedToday: false, lastSeen: null, memory: null });

    const giftedP = next<NpcGiftedMessage>(room, ServerMessage.NpcGifted);
    room.send(ClientMessage.NpcGift, { conversationId: ctx.conversationId, itemId: "butter" });
    expect(await giftedP).toMatchObject({ ok: true, reaction: "liked", delta: 1, hearts: 1.25, inventory: [] });

    const appliedP = next<NpcAppliedMessage>(room, ServerMessage.NpcApplied);
    room.send(ClientMessage.NpcReply, { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: [] });
    await appliedP;
    room.send(ClientMessage.NpcEnd, { conversationId: ctx.conversationId });
    const rememberedP = next<NpcRememberedMessage>(room, ServerMessage.NpcRemembered);
    room.send(ClientMessage.NpcMemory, {
      conversationId: ctx.conversationId,
      summary: "Kenji loves butter.",
      facts: ["Kenji gave me butter"],
      signals: { comprehension: 0.8, expression: 0.7, usedNativeLanguage: false, struggles: [] },
      telemetry: { suggested: 0, free: 1, npcLines: 2, translationsShown: 0, corrections: 0 },
    });
    expect(await rememberedP).toMatchObject({ conversationId: ctx.conversationId, npcId: "baker", level: "B2", levelChange: 0 });
    expect(store.players.get("kenji/ja")!.memory?.baker).toEqual({ summary: "Kenji loves butter.", facts: ["Kenji gave me butter"] });

    // The next conversation knows it.
    const againP = next<NpcContextMessage>(room, ServerMessage.NpcContext);
    room.send(ClientMessage.NpcStart, { npcId: "baker" });
    expect((await againP).memory?.facts).toEqual(["Kenji gave me butter"]);
  });
});
