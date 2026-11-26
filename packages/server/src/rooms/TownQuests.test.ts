import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  CAST_COOLDOWN_MS,
  ClientMessage,
  type CookResultMessage,
  dailyBoard,
  dailySpawns,
  type FishCastResultMessage,
  type FishResultMessage,
  type ForageResultMessage,
  getForage,
  getQuestTemplate,
  type InventoryStateMessage,
  type ItemId,
  kitchenSpot,
  minReelMs,
  NPC_POSTS,
  type NpcAppliedMessage,
  type NpcContextMessage,
  type NpcId,
  noticeBoardSpot,
  npcOffers,
  phaseForClockMinutes,
  type Quest,
  QUEST_KINDS,
  type QuestKind,
  type QuestResultMessage,
  type QuestStateMessage,
  RoomName,
  ServerMessage,
  type SlotEntry,
  type SpacePoint,
  type UserProfile,
  WORLD_DAY_MS,
  WORLD_EPOCH_MS,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryFishingStore } from "../fishing/fishingStore";
import { createMemoryFoodStore, type MemoryFoodStore } from "../food/foodStore";
import { createMemoryForageStore } from "../forage/forageStore";
import { createMemoryNpcStore, type MemoryNpcStore } from "../npc/npcStore";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createMemoryQuestStore, type MemoryQuestStore } from "../quests/questStore";
import { createGameServer, type GameServer } from "../server";

/**
 * Build plan M30 acceptance over the real Colyseus SDK: one request of each kind (deliver, fetch,
 * catch, cook, find) is taken and completed end to end on the server. Three come from the Town
 * Hall board (`quest:accept` at the notice board), two are villagers' favours handed out by the
 * model's `giveQuest`. A delivery is completed by the model's `completeQuest` (the server checks
 * the NPC, the bag and the deadline), a fetch by the "Hand over" card (`quest:handover`); catch,
 * cook and find complete on the server's own catch, dish and pick-up. Rewards (coins, hearts with
 * the requester, the bag) are the server's. The stores and the fake clock outlive each server, so
 * the player "walks" from place to place by reconnecting to a new server started there.
 */

// Every visit starts a new game server, and each Colyseus server adds process signal listeners.
process.setMaxListeners(40);

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

const DAY = 300;
const SHARD = 1;
/** Real time at in-game `minutes` of world day `day`. */
const at = (minutes: number, day = DAY) => WORLD_EPOCH_MS + day * WORLD_DAY_MS + Math.round(phaseForClockMinutes(minutes) * WORLD_DAY_MS);
const ROD: SlotEntry = { slot: 24, itemId: "fishing_rod", qty: 1 };
const DOCK: SpacePoint = { space: "town", pos: [53, 30.25], heading: Math.PI };
const BOARD: SpacePoint = { space: "town", pos: noticeBoardSpot(), heading: Math.PI };
const talkSpot = (npcId: NpcId): SpacePoint => ({ space: NPC_POSTS[npcId].space, pos: NPC_POSTS[npcId].talkSpot, heading: Math.PI });

let server: GameServer | null = null;
let rooms: Room[] = [];

async function stop(): Promise<void> {
  await Promise.all(rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  rooms = [];
  await server?.gracefullyShutdown(false);
  server = null;
}

afterEach(stop);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      await sleep(5);
    }
    return this.all[this.seen++]!;
  }
  get last(): T | undefined {
    return this.all.at(-1);
  }
}

interface World {
  uid: string;
  npcStore: MemoryNpcStore;
  foodStore: MemoryFoodStore;
  questStore: MemoryQuestStore;
  clock: { now: number };
}

async function serve(w: World, spawn: SpacePoint): Promise<string> {
  await stop();
  server = createGameServer({
    verifier: fakeVerifier,
    profiles: createMemoryProfileStore({ [w.uid]: profile("Lia") }),
    npcStore: w.npcStore,
    fishing: { store: createMemoryFishingStore(w.npcStore), now: () => w.clock.now, seed: 30 },
    forage: { store: createMemoryForageStore(w.npcStore), now: () => w.clock.now },
    food: { store: w.foodStore, now: () => w.clock.now },
    quests: { store: w.questStore, now: () => w.clock.now },
    town: { spawn },
  });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

interface Player {
  room: Room;
  state: Inbox<QuestStateMessage>;
  result: Inbox<QuestResultMessage>;
  inventory: Inbox<InventoryStateMessage>;
  context: Inbox<NpcContextMessage>;
  applied: Inbox<NpcAppliedMessage>;
  cast: Inbox<FishCastResultMessage>;
  fish: Inbox<FishResultMessage>;
  cooked: Inbox<CookResultMessage>;
  forage: Inbox<ForageResultMessage>;
}

async function visit(w: World, spawn: SpacePoint): Promise<Player> {
  const url = await serve(w, spawn);
  const room = await new Client(url).joinOrCreate(RoomName.Town, { idToken: `valid:${w.uid}` });
  rooms.push(room);
  const p: Player = {
    room,
    state: new Inbox(room, ServerMessage.QuestState),
    result: new Inbox(room, ServerMessage.QuestResult),
    inventory: new Inbox(room, ServerMessage.InventoryState),
    context: new Inbox(room, ServerMessage.NpcContext),
    applied: new Inbox(room, ServerMessage.NpcApplied),
    cast: new Inbox(room, ServerMessage.FishCast),
    fish: new Inbox(room, ServerMessage.FishResult),
    cooked: new Inbox(room, ServerMessage.CookResult),
    forage: new Inbox(room, ServerMessage.ForageResult),
  };
  await p.state.next("the quests on join");
  await p.inventory.next("the inventory on join");
  return p;
}

async function talk(p: Player, npcId: NpcId): Promise<NpcContextMessage> {
  p.room.send(ClientMessage.NpcStart, { npcId });
  return p.context.next(`npc:context of the ${npcId}`);
}

/** The player whose day has one request of each kind between the board and the two favours (deterministic search). */
function findPlayer(): { uid: string; board: Quest[]; offers: Quest[]; byKind: Record<QuestKind, Quest> } {
  for (let i = 0; i < 20_000; i++) {
    const uid = `p${i}`;
    const board = dailyBoard(uid, "es", DAY);
    const offers = npcOffers(uid, "es", DAY);
    const byKind: Partial<Record<QuestKind, Quest>> = {};
    for (const q of [...board, ...offers]) byKind[q.template.target.kind] ??= q;
    if (!QUEST_KINDS.every((k) => byKind[k])) continue;
    // Any fish (the seeded roll decides the species), and enough spawns of the kind to find today.
    const c = byKind.catch!.template.target;
    if (c.kind !== "catch" || c.fishId) continue;
    const f = byKind.find!.template.target;
    if (f.kind !== "find" || dailySpawns(SHARD, DAY).filter((s) => s.kind === "forage" && getForage(s.itemId)?.kind === f.forageKind).length < f.qty) continue;
    // The hand-ins go to different villagers than the favours' givers, so every step is its own visit.
    return { uid, board, offers, byKind: byKind as Record<QuestKind, Quest> };
  }
  throw new Error("no player with all five kinds");
}

/** The request's target, narrowed to its kind (the kind is checked). */
const target = <K extends QuestKind>(q: Quest, kind: K) => {
  if (q.template.target.kind !== kind) throw new Error(`${q.questId} is not a ${kind} request`);
  return q.template.target as Extract<Quest["template"]["target"], { kind: K }>;
};

describe("M30 · daily requests and quests (TownRoom)", () => {
  it("acceptance: one request of each kind (deliver, fetch, catch, cook, find) is taken and completed on the server", async () => {
    const { uid, board, offers, byKind } = findPlayer();
    const deliver = byKind.deliver;
    const fetch = byKind.fetch;
    const cook = byKind.cook;
    const find = byKind.find;
    const recipe = target(cook, "cook").recipeId;
    const ingredients: Record<string, [ItemId, number][]> = { bread: [["flour", 2], ["milk", 1]], omelette: [["egg", 2], ["onion", 1]] };
    const want: [ItemId, number][] = [[target(deliver, "deliver").itemId, target(deliver, "deliver").qty], [target(fetch, "fetch").itemId, target(fetch, "fetch").qty], ...ingredients[recipe]!];
    const slots: SlotEntry[] = [...want.map(([itemId, qty], slot) => ({ slot, itemId, qty })), ROD];
    const npcStore = createMemoryNpcStore({ [`${uid}/es`]: { level: "A2", coins: 0, hearts: {}, slots } });
    const w: World = {
      uid,
      npcStore,
      foodStore: createMemoryFoodStore(npcStore, { [uid]: { known: { [recipe]: { teacher: getQuestTemplate(cook.template.id)!.giver, lang: "es", learnedMs: 0, cooked: 0 } } } }),
      questStore: createMemoryQuestStore(npcStore),
      clock: { now: at(7 * 60) },
    };

    // 1. At the Town Hall notice board: today's three requests, all open; take them.
    let p = await visit(w, BOARD);
    expect(p.state.last!.day).toBe(DAY);
    expect(p.state.last!.board.map((v) => [v.questId, v.status])).toEqual(board.map((q) => [q.questId, "open"]));
    expect(p.state.last!.log).toEqual([]);
    // A favour is not on the board, and a made-up request is nobody's.
    p.room.send(ClientMessage.QuestAccept, { questId: offers[0]!.questId });
    expect(await p.result.next("quest:result")).toEqual({ questId: offers[0]!.questId, action: "accept", ok: false, reason: "wrong_npc" });
    w.clock.now += 400;
    p.room.send(ClientMessage.QuestAccept, { questId: `q${DAY}-free_hearts` });
    expect(await p.result.next("quest:result")).toMatchObject({ ok: false, reason: "unknown_quest" });
    for (const q of board) {
      w.clock.now += 400;
      p.room.send(ClientMessage.QuestAccept, { questId: q.questId });
      expect(await p.result.next(`accept ${q.questId}`)).toEqual({ questId: q.questId, action: "accept", ok: true, via: "board" });
      expect((await p.state.next("quests after accepting")).log.find((v) => v.questId === q.questId)?.status).toBe("active");
    }
    w.clock.now += 400;
    p.room.send(ClientMessage.QuestAccept, { questId: board[0]!.questId });
    expect(await p.result.next("quest:result")).toMatchObject({ ok: false, reason: "already_accepted" });

    // 2. The villagers' favours, handed out by the model's giveQuest (only the giver's own favour).
    for (const q of offers) {
      const giver = q.template.giver;
      p = await visit(w, talkSpot(giver));
      const ctx = await talk(p, giver);
      expect(ctx.quests).toContainEqual(expect.objectContaining({ questId: q.questId, status: "offered", role: "asked" }));
      const other = offers.find((o) => o !== q)!;
      p.room.send(ClientMessage.NpcReply, {
        conversationId: ctx.conversationId,
        turnId: ctx.turnId,
        actions: [
          { type: "giveQuest", questId: q.questId },
          { type: "giveQuest", questId: other.questId },
        ],
      });
      const applied = await p.applied.next("npc:applied");
      expect(applied.accepted).toContainEqual({ type: "giveQuest", questId: q.questId });
      expect(applied.rejected).toContainEqual({ type: "giveQuest", reason: "unknown_quest" });
      expect(await p.result.next("quest:result")).toEqual({ questId: q.questId, action: "accept", ok: true, via: "npc" });
      expect((await p.state.next("quests after the favour")).log.find((v) => v.questId === q.questId)?.status).toBe("active");
    }

    const coinsBefore = () => npcStore.players.get(`${uid}/es`)!.coins;
    const heartsWith = (npcId: NpcId) => npcStore.players.get(`${uid}/es`)!.hearts[npcId] ?? 0;
    const completed = async (q: Quest, via: string) => {
      const r = await p.result.next(`quest:result for ${q.questId}`);
      expect(r).toMatchObject({ questId: q.questId, action: "complete", ok: true, via, reward: q.reward });
      return r;
    };

    // 3. deliver: the model proposes completeQuest at the recipient; the server checks and pays.
    const to = target(deliver, "deliver").to;
    p = await visit(w, talkSpot(to));
    let ctx = await talk(p, to);
    expect(ctx.quests).toContainEqual(expect.objectContaining({ questId: deliver.questId, status: "active", canComplete: true }));
    let coins = coinsBefore();
    const giverHearts = heartsWith(deliver.template.giver);
    p.room.send(ClientMessage.NpcReply, {
      conversationId: ctx.conversationId,
      turnId: ctx.turnId,
      // The fetch is not this villager's to complete (unless it is also theirs), and a made-up one never is.
      actions: [
        { type: "completeQuest", questId: deliver.questId },
        { type: "completeQuest", questId: `q${DAY}-free_hearts` },
      ],
    });
    let applied = await p.applied.next("npc:applied");
    expect(applied.accepted).toContainEqual({ type: "completeQuest", questId: deliver.questId });
    expect(applied.rejected).toContainEqual({ type: "completeQuest", reason: "conditions_not_met" });
    await completed(deliver, "npc");
    expect(coinsBefore()).toBe(coins + deliver.reward.coins);
    expect(heartsWith(deliver.template.giver)).toBe(giverHearts + deliver.reward.hearts);
    const after = await p.inventory.next("the bag after the delivery");
    expect(after.coins).toBe(coinsBefore());
    // A second completeQuest for the same request is refused (it is done).
    p.room.send(ClientMessage.NpcReply, { conversationId: ctx.conversationId, turnId: applied.nextTurnId!, actions: [{ type: "completeQuest", questId: deliver.questId }] });
    applied = await p.applied.next("npc:applied");
    expect(applied.rejected).toEqual([{ type: "completeQuest", reason: "conditions_not_met" }]);

    // 4. fetch: the "Hand over" card at the requester.
    const fetchTo = fetch.template.giver;
    p = await visit(w, talkSpot(fetchTo));
    ctx = await talk(p, fetchTo);
    coins = coinsBefore();
    // Without the conversation it goes nowhere.
    p.room.send(ClientMessage.QuestTurnIn, { conversationId: "not-a-conversation", questId: fetch.questId });
    expect(await p.result.next("quest:result")).toMatchObject({ ok: false, reason: "no_conversation" });
    p.room.send(ClientMessage.QuestTurnIn, { conversationId: ctx.conversationId, questId: fetch.questId });
    await completed(fetch, "hand_over");
    expect(coinsBefore()).toBe(coins + fetch.reward.coins);
    const fetchItem = target(fetch, "fetch").itemId;
    expect((await p.inventory.next("the bag after the hand-over")).slots.some((s) => s.itemId === fetchItem)).toBe(false);

    // 5. catch: the server's catches count; the request completes by itself.
    const catchQuest = byKind.catch;
    p = await visit(w, DOCK);
    // Accepting from the dock is too far from the board.
    p.room.send(ClientMessage.QuestAccept, { questId: board[0]!.questId });
    expect(await p.result.next("quest:result")).toMatchObject({ ok: false, reason: "too_far" });
    coins = coinsBefore();
    for (let i = 0; i < target(catchQuest, "catch").qty; i++) {
      p.room.send(ClientMessage.FishCast, { slot: ROD.slot, charge: 1, heading: Math.PI });
      const c = await p.cast.next("fish:cast");
      if (!c.ok) throw new Error(`cast refused: ${c.reason}`);
      w.clock.now += c.biteInMs + 300 + minReelMs(c.rarity);
      p.room.send(ClientMessage.FishReel, { castId: c.castId, outcome: "caught" });
      expect(await p.fish.next("fish:result")).toMatchObject({ outcome: "caught" });
      w.clock.now += CAST_COOLDOWN_MS;
    }
    await completed(catchQuest, "auto");
    expect(coinsBefore()).toBe(coins + catchQuest.reward.coins);

    // 6. cook: the server's dish at the kitchen counts.
    p = await visit(w, { space: "apartment", pos: kitchenSpot(), heading: 0 });
    coins = coinsBefore();
    p.room.send(ClientMessage.CookMake, { recipeId: recipe });
    expect(await p.cooked.next("cook:result")).toMatchObject({ ok: true, recipeId: recipe });
    await completed(cook, "auto");
    expect(coinsBefore()).toBe(coins + cook.reward.coins);

    // 7. find: the server's pick-ups of the right kind count (one visit per spawn).
    const kind = target(find, "find").forageKind;
    const spots = dailySpawns(SHARD, DAY).filter((s) => s.kind === "forage" && getForage(s.itemId)?.kind === kind).slice(0, target(find, "find").qty);
    coins = coinsBefore();
    for (const spawn of spots) {
      p = await visit(w, { space: "town", pos: spawn.pos, heading: 0 });
      w.clock.now += 1000;
      p.room.send(ClientMessage.ForagePick, { spawnId: spawn.spawnId });
      expect(await p.forage.next("forage:result")).toMatchObject({ ok: true, itemId: spawn.itemId });
    }
    await completed(find, "auto");
    expect(coinsBefore()).toBe(coins + find.reward.coins);

    // All five are done: the log says so, the counts went up, and every requester gained hearts.
    const final = await p.state.next("quests after the last one");
    expect(final.log).toHaveLength(5);
    expect(final.log.every((v) => v.status === "completed")).toBe(true);
    const log = w.questStore.logs.get(`${uid}/es`)!;
    expect(log.completed).toEqual({ deliver: 1, fetch: 1, catch: 1, cook: 1, find: 1 });
    for (const q of [deliver, fetch, catchQuest, cook, find]) expect(heartsWith(q.template.giver)).toBeGreaterThanOrEqual(1);
    const total = [deliver, fetch, catchQuest, cook, find].reduce((sum, q) => sum + q.reward.coins, 0);
    expect(coinsBefore()).toBe(total);
  }, 60_000);

  it("refuses a short or late delivery, and pushes a new board the next in-game day", async () => {
    const { uid, byKind } = findPlayer();
    const deliver = byKind.deliver;
    const t = target(deliver, "deliver");
    const npcStore = createMemoryNpcStore({ [`${uid}/es`]: { level: "A2", coins: 0, hearts: {}, slots: [{ slot: 0, itemId: t.itemId, qty: t.qty - 1 }] } });
    const w: World = { uid, npcStore, foodStore: createMemoryFoodStore(npcStore), questStore: createMemoryQuestStore(npcStore), clock: { now: at(7 * 60) } };
    // Take the delivery (from the board or its giver).
    let p: Player;
    if (deliver.source === "board") {
      p = await visit(w, BOARD);
      p.room.send(ClientMessage.QuestAccept, { questId: deliver.questId });
    } else {
      p = await visit(w, talkSpot(deliver.template.giver));
      const ctx = await talk(p, deliver.template.giver);
      p.room.send(ClientMessage.NpcReply, { conversationId: ctx.conversationId, turnId: ctx.turnId, actions: [{ type: "giveQuest", questId: deliver.questId }] });
    }
    expect(await p.result.next("accepted")).toMatchObject({ ok: true, action: "accept" });

    // One item short: the hand-over is refused and nothing is paid.
    p = await visit(w, talkSpot(t.to));
    let ctx = await talk(p, t.to);
    expect(ctx.quests.find((b) => b.questId === deliver.questId)?.canComplete).toBeUndefined();
    p.room.send(ClientMessage.QuestTurnIn, { conversationId: ctx.conversationId, questId: deliver.questId });
    expect(await p.result.next("refused")).toMatchObject({ ok: false, reason: "missing_items" });
    expect(npcStore.players.get(`${uid}/es`)!.coins).toBe(0);

    // With the items but after the deadline: too late, and the log shows it expired.
    npcStore.players.get(`${uid}/es`)!.slots = [{ slot: 0, itemId: t.itemId, qty: t.qty }];
    const [hh, mm] = t.by.split(":").map(Number) as [number, number];
    w.clock.now = at(hh * 60 + mm + 30);
    p = await visit(w, talkSpot(t.to));
    expect(p.state.last!.log.find((v) => v.questId === deliver.questId)?.status).toBe("expired");
    ctx = await talk(p, t.to);
    p.room.send(ClientMessage.QuestTurnIn, { conversationId: ctx.conversationId, questId: deliver.questId });
    expect(await p.result.next("refused")).toMatchObject({ ok: false, reason: "too_late" });
    expect(npcStore.players.get(`${uid}/es`)!.slots).toEqual([{ slot: 0, itemId: t.itemId, qty: t.qty }]);

    // The next in-game day the room pushes a fresh board and an empty log.
    w.clock.now = at(7 * 60, DAY + 1);
    const next = await p.state.next("the next day's board", 4000);
    expect(next.day).toBe(DAY + 1);
    expect(next.board.map((v) => v.questId)).toEqual(dailyBoard(uid, "es", DAY + 1).map((q) => q.questId));
    expect(next.log).toEqual([]);
  }, 30_000);
});
