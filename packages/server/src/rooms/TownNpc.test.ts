import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ClientMessage,
  type NpcAppliedMessage,
  type NpcContextMessage,
  type NpcRefusedMessage,
  type NpcTradeMessage,
  RoomName,
  ServerMessage,
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

async function start(store: MemoryNpcStore): Promise<Room> {
  server = createGameServer({ verifier: fakeVerifier, profiles: createMemoryProfileStore({ kenji }), npcStore: store });
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
});
