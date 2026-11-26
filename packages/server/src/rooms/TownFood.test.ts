import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  type BuffsMessage,
  ClientMessage,
  type CookResultMessage,
  EAT_COOLDOWN_MS,
  type FoodEatenMessage,
  HOTBAR_FIRST_SLOT,
  type InventoryStateMessage,
  kitchenSpot,
  NPC_POSTS,
  type NpcAppliedMessage,
  type NpcContextMessage,
  type NpcId,
  type PlayerMoveMessage,
  type RecipeBookMessage,
  RoomName,
  type SeatStateMessage,
  ServerMessage,
  type SlotEntry,
  type SpacePoint,
  spaceSeats,
  type TownPlayerView,
  type UserProfile,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryFoodStore, type MemoryFoodStore } from "../food/foodStore";
import { createMemoryNpcStore, type MemoryNpcStore } from "../npc/npcStore";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer } from "../server";

/**
 * Build plan M29 acceptance over the real Colyseus SDK: learn bread from the Baker (an accepted
 * `teachRecipe` goes into the server's recipe book), cook it at the apartment kitchen (2 flour +
 * 1 milk → bread, server-validated), eat it from the hotbar, and the walk-speed buff is active and
 * then runs out (`buffs:state`). Also: three cakes make the Doctor's context scold, coffee gives
 * the extra hint, and seats are checked against the server's walker and who already sits there.
 * The food clock is a fake one the test advances.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const profile = (name: string): UserProfile => ({
  name,
  animal: "otter",
  colors: { fur: "", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "3A",
  nativeLang: "en",
  targetLangs: ["es"],
  style: "european",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});

const H = HOTBAR_FIRST_SLOT;
const talkSpot = (npcId: NpcId): SpacePoint => ({ space: NPC_POSTS[npcId].space, pos: NPC_POSTS[npcId].talkSpot, heading: Math.PI });

let server: GameServer | null = null;
let rooms: Room[] = [];

afterEach(async () => {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, probe: () => T | undefined | null | false, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

class Inbox<T> {
  readonly all: T[] = [];
  private seen = 0;
  constructor(room: Room, type: string) {
    room.onMessage(type, (m: T) => this.all.push(m));
  }
  async next(what = "a message", ms = 3000): Promise<T> {
    await until(what, () => this.all.length > this.seen, ms);
    return this.all[this.seen++]!;
  }
  get last(): T | undefined {
    return this.all.at(-1);
  }
}

interface World {
  npcStore: MemoryNpcStore;
  foodStore: MemoryFoodStore;
  clock: { now: number };
}

function world(slots: SlotEntry[]): World {
  const npcStore = createMemoryNpcStore({ "lia/es": { level: "A2", coins: 10, hearts: {}, slots }, "max/es": { level: "A2", coins: 10, hearts: {}, slots: [] } });
  return { npcStore, foodStore: createMemoryFoodStore(npcStore), clock: { now: 1_800_000_000_000 } };
}

async function serve(w: World, spawn: SpacePoint): Promise<string> {
  server = createGameServer({
    verifier: fakeVerifier,
    profiles: createMemoryProfileStore({ lia: profile("Lia"), max: profile("Max") }),
    npcStore: w.npcStore,
    food: { store: w.foodStore, now: () => w.clock.now },
    town: { spawn },
  });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function stop(): Promise<void> {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
}

interface Eater {
  room: Room;
  inventory: Inbox<InventoryStateMessage>;
  book: Inbox<RecipeBookMessage>;
  buffs: Inbox<BuffsMessage>;
  eaten: Inbox<FoodEatenMessage>;
  cooked: Inbox<CookResultMessage>;
  context: Inbox<NpcContextMessage>;
  applied: Inbox<NpcAppliedMessage>;
  seat: Inbox<SeatStateMessage>;
}

async function join(url: string, uid = "lia"): Promise<Eater> {
  const room = await new Client(url).joinOrCreate(RoomName.Town, { idToken: `valid:${uid}` });
  rooms.push(room);
  const e: Eater = {
    room,
    inventory: new Inbox(room, ServerMessage.InventoryState),
    book: new Inbox(room, ServerMessage.RecipeBook),
    buffs: new Inbox(room, ServerMessage.Buffs),
    eaten: new Inbox(room, ServerMessage.FoodEaten),
    cooked: new Inbox(room, ServerMessage.CookResult),
    context: new Inbox(room, ServerMessage.NpcContext),
    applied: new Inbox(room, ServerMessage.NpcApplied),
    seat: new Inbox(room, ServerMessage.SeatState),
  };
  await e.inventory.next("the inventory on join");
  await e.book.next("the recipe book on join");
  await e.buffs.next("the buffs on join");
  return e;
}

const self = (room: Room): TownPlayerView | undefined => (room.state as { players?: Map<string, TownPlayerView> }).players?.get(room.sessionId);

async function eat(e: Eater, w: World, slot: number): Promise<FoodEatenMessage> {
  w.clock.now += EAT_COOLDOWN_MS + 10;
  e.room.send(ClientMessage.FoodEat, { slot });
  return e.eaten.next(`food:eaten for slot ${slot}`);
}

describe("M29 · eating, cooking and buffs (TownRoom)", () => {
  it("acceptance: learn bread from the Baker, cook it, eat it, and the buff is active and then runs out", async () => {
    const w = world([
      { slot: 0, itemId: "flour", qty: 2 },
      { slot: 1, itemId: "milk", qty: 1 },
    ]);

    // 1. At the bakery: the Baker teaches bread (0 hearts needed); the server keeps it.
    const atBakery = await join(await serve(w, talkSpot("baker")));
    expect(atBakery.book.last!.book).toEqual({ known: {} });
    atBakery.room.send(ClientMessage.NpcStart, { npcId: "baker" });
    const ctx = await atBakery.context.next("npc:context");
    expect(ctx.recipes.find((r) => r.recipeId === "bread")).toMatchObject({ known: false, heartsRequired: 0 });
    // The model proposes the recipe plus one the Baker does not teach.
    atBakery.room.send(ClientMessage.NpcReply, {
      conversationId: ctx.conversationId,
      turnId: ctx.turnId,
      actions: [
        { type: "teachRecipe", recipeId: "bread" },
        { type: "teachRecipe", recipeId: "fish_stew" },
      ],
    });
    const applied = await atBakery.applied.next("npc:applied");
    expect(applied.accepted).toContainEqual({ type: "teachRecipe", recipeId: "bread" });
    expect(applied.rejected).toContainEqual({ type: "teachRecipe", reason: "not_teacher" });
    const learned = await atBakery.book.next("the book after the lesson");
    expect(learned.book.known.bread).toMatchObject({ teacher: "baker", lang: "es", cooked: 0 });
    expect(learned.book.known.fish_stew).toBeUndefined();
    // Next time the Baker knows the player knows it.
    atBakery.room.send(ClientMessage.NpcStart, { npcId: "baker" });
    expect((await atBakery.context.next("npc:context again")).recipes.find((r) => r.recipeId === "bread")?.known).toBe(true);
    await stop();

    // 2. At home, at the kitchen nook: cook it (the same stores, a fresh server process).
    const home = await join(await serve(w, { space: "apartment", pos: kitchenSpot(), heading: 0 }));
    expect(Object.keys(home.book.last!.book.known)).toEqual(["bread"]);
    home.room.send(ClientMessage.CookMake, { recipeId: "omelette" });
    expect(await home.cooked.next("cook:result")).toEqual({ recipeId: "omelette", ok: false, reason: "not_known" });
    w.clock.now += 2000;
    home.room.send(ClientMessage.CookMake, { recipeId: "bread" });
    expect(await home.cooked.next("cook:result")).toEqual({
      recipeId: "bread",
      ok: true,
      itemId: "bread",
      uses: [
        { itemId: "flour", qty: 2 },
        { itemId: "milk", qty: 1 },
      ],
    });
    expect((await home.inventory.next("inventory after cooking")).slots).toEqual([{ slot: 0, itemId: "bread", qty: 1 }]);
    expect((await home.book.next("book after cooking")).book.known.bread?.cooked).toBe(1);
    // Nothing left to cook with, and a forged recipe id never reaches the handler.
    w.clock.now += 2000;
    home.room.send(ClientMessage.CookMake, { recipeId: "bread" });
    expect(await home.cooked.next("cook:result")).toMatchObject({ ok: false, reason: "missing_ingredients" });
    home.room.send(ClientMessage.CookMake, { recipeId: "golden_cake" });
    await sleep(100);
    expect(home.cooked.all).toHaveLength(3);

    // 3. Eat it from the hotbar: not from the bag, then from hotbar slot 24.
    expect(await eat(home, w, 0)).toEqual({ slot: 0, ok: false, reason: "not_hotbar" });
    home.room.send(ClientMessage.InventoryMove, { from: 0, to: H, moveId: 1 });
    expect((await home.inventory.next("the bread in the hotbar")).slots).toEqual([{ slot: H, itemId: "bread", qty: 1 }]);
    const bite = await eat(home, w, H);
    expect(bite).toEqual({
      slot: H,
      ok: true,
      itemId: "bread",
      emote: null,
      buff: { kind: "walk_speed", amount: 0.1, itemId: "bread", remainingMs: 5 * 60_000, durationMs: 5 * 60_000 },
    });
    expect((await home.inventory.next("inventory after the bite")).slots).toEqual([]);
    expect((await home.buffs.next("buffs after the bite")).buffs).toEqual([bite.ok ? bite.buff : null]);
    await until("the synced eating activity", () => self(home.room)?.activity === "eating");
    // The slot is empty now.
    expect(await eat(home, w, H)).toEqual({ slot: H, ok: false, reason: "empty_slot" });

    // 4. Five minutes later the buff runs out and the player is told.
    w.clock.now += 5 * 60_000;
    expect((await home.buffs.next("buffs after they run out", 3000)).buffs).toEqual([]);
  }, 20_000);

  it("three cakes make the Doctor's context scold; coffee gives one extra hint", async () => {
    const w = world([
      { slot: H, itemId: "cake", qty: 3 },
      { slot: H + 1, itemId: "coffee", qty: 1 },
      { slot: H + 2, itemId: "fishing_rod", qty: 1 },
    ]);
    const lia = await join(await serve(w, talkSpot("doctor")));
    for (let i = 0; i < 3; i++) expect(await eat(lia, w, H)).toMatchObject({ ok: true, itemId: "cake", emote: "cheer", buff: null });
    expect(await eat(lia, w, H + 2)).toEqual({ slot: H + 2, ok: false, reason: "not_food" });
    // A second bite right away is too soon.
    lia.room.send(ClientMessage.FoodEat, { slot: H + 1 });
    expect(await lia.eaten.next("food:eaten")).toEqual({ slot: H + 1, ok: false, reason: "cooldown" });
    expect(await eat(lia, w, H + 1)).toMatchObject({ ok: true, itemId: "coffee", buff: { kind: "reply_hint", amount: 1 } });

    lia.room.send(ClientMessage.NpcStart, { npcId: "doctor" });
    const ctx = await lia.context.next("npc:context");
    expect(ctx.flags.some((f) => /3 cakes today/.test(f))).toBe(true);
    expect(ctx.extraHints).toBe(1);
    // Once the coffee wears off, no extra hint.
    w.clock.now += 11 * 60_000;
    await sleep(3100); // the start rate limit
    lia.room.send(ClientMessage.NpcStart, { npcId: "doctor" });
    expect((await lia.context.next("npc:context")).extraHints).toBe(0);
  }, 15_000);

  it("seats: sit next to a bench, one player per seat, walking off stands you up", async () => {
    const seat = spaceSeats("town")[0]!;
    const w = world([]);
    // Stand in front of the bench (the side it faces).
    const front: [number, number] = [seat.pos[0] + Math.sin(seat.facing) * 0.9, seat.pos[1] + Math.cos(seat.facing) * 0.9];
    const url = await serve(w, { space: "town", pos: front, heading: 0 });
    const lia = await join(url, "lia");
    const max = await join(url, "max");
    lia.room.send(ClientMessage.SeatSit, { seatId: seat.id });
    expect(await lia.seat.next("seat:state")).toEqual({ seatId: seat.id });
    await until("the synced seat", () => self(lia.room)?.seat === seat.id);
    // Taken; an unknown seat; a forged id format.
    max.room.send(ClientMessage.SeatSit, { seatId: seat.id });
    expect(await max.seat.next("seat:state")).toEqual({ seatId: null, refused: "taken" });
    max.room.send(ClientMessage.SeatSit, { seatId: "cafe-chair-0" });
    expect(await max.seat.next("seat:state")).toEqual({ seatId: null, refused: "unknown_seat" });
    const far = spaceSeats("town").find((s) => Math.hypot(s.pos[0] - seat.pos[0], s.pos[1] - seat.pos[1]) > 4)!;
    max.room.send(ClientMessage.SeatSit, { seatId: far.id });
    expect(await max.seat.next("seat:state")).toEqual({ seatId: null, refused: "too_far" });
    max.room.send(ClientMessage.SeatSit, { seatId: "../../x" });
    await sleep(100);
    expect(max.seat.all).toHaveLength(3);

    // Walking off stands Lia up; then Max may sit there.
    const move: PlayerMoveMessage = { seq: 1, epoch: 0, space: "town", x: front[0] + 0.4 * Math.sin(seat.facing), z: front[1] + 0.4 * Math.cos(seat.facing), heading: 0, motion: "walk" };
    lia.room.send(ClientMessage.PlayerMove, move);
    expect(await lia.seat.next("seat:state after walking off")).toEqual({ seatId: null });
    await until("the seat cleared", () => self(lia.room)?.seat === "");
    max.room.send(ClientMessage.SeatSit, { seatId: seat.id });
    expect(await max.seat.next("seat:state")).toEqual({ seatId: seat.id });
    max.room.send(ClientMessage.SeatStand, {});
    expect(await max.seat.next("seat:state")).toEqual({ seatId: null });
  }, 15_000);
});
