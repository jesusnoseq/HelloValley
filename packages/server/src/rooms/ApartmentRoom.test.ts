import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  type ApartmentLayoutData,
  type ApartmentOccupantView,
  apartmentNavGrid,
  type ApartmentStateView,
  applyFurnitureEdit,
  ClientMessage,
  defaultApartmentLayout,
  type EmoteBroadcast,
  type FurnitureEditMessage,
  type FurnitureResultMessage,
  type IntercomListMessage,
  intercomInteractable,
  type MoveCorrectionMessage,
  PlayerController,
  type PlayerMoveMessage,
  RoomName,
  ServerMessage,
  type SpaceGrids,
  spaceDoors,
  spaceGrid,
  type TownPlayerView,
  type UserProfile,
  VISIT_ENDED_CODE,
  type VisitIncomingMessage,
  type VisitStatusMessage,
  type WelcomeMessage,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryLayoutStore, type MemoryLayoutStore } from "../apartments/layoutStore";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer } from "../server";
import { TOWN_SPAWN } from "./TownRoom";

/**
 * Multi-client apartment tests (build plan M17) with the real Colyseus SDK in Node: the lobby
 * intercom, visits, the owner's furniture seen by a visitor, edits that persist, and the
 * owner-only rule. Auth is mocked (`valid:<uid>` tokens), the layout store is in memory.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const profileOf = (name: string, apartmentId: "6D" | "2B" | "9H"): UserProfile => ({
  name,
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId,
  nativeLang: "en",
  targetLangs: ["ja"],
  style: "japanese",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});

function edited(layout: ApartmentLayoutData, edit: Parameters<typeof applyFurnitureEdit>[1]): ApartmentLayoutData {
  const r = applyFurnitureEdit(layout, edit);
  if (!r.ok) throw new Error(r.reason);
  return r.layout;
}

const CHAIR = 10; // the first wooden chair of the starting layout
const BED = 4;
/** Alice already rearranged her studio once: one chair is in storage. */
const ALICE_LAYOUT = edited(defaultApartmentLayout(), { op: "store", index: CHAIR, itemId: "wooden_chair" });

interface Harness {
  server: GameServer;
  baseUrl: string;
  layouts: MemoryLayoutStore;
  rooms: Room[];
}

let harness: Harness | null = null;

async function start(): Promise<Harness> {
  const layouts = createMemoryLayoutStore({ alice: ALICE_LAYOUT });
  const profiles = createMemoryProfileStore({ alice: profileOf("Alice", "6D"), bob: profileOf("Bob", "2B"), carol: profileOf("Carol", "9H") });
  const server = createGameServer({ verifier: fakeVerifier, profiles, layouts, layoutSaveDebounceMs: 50 });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  harness = { server, baseUrl: `http://127.0.0.1:${port}`, layouts, rooms: [] };
  return harness;
}

afterEach(async () => {
  if (!harness) return;
  const h = harness;
  harness = null;
  await Promise.all(h.rooms.map((r) => (r.connection.isOpen ? r.leave().catch(() => undefined) : undefined)));
  await h.server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** Collects every message of one type a room receives. */
function inbox<T>(room: Room, type: string): T[] {
  const list: T[] = [];
  room.onMessage(type, (m: T) => list.push(m));
  return list;
}

interface TownPlayer {
  uid: string;
  room: Room;
  corrections: MoveCorrectionMessage[];
  emotes: EmoteBroadcast[];
  intercom: IntercomListMessage[];
  incoming: VisitIncomingMessage[];
  status: VisitStatusMessage[];
}

async function joinTown(h: Harness, uid: string): Promise<TownPlayer> {
  const room = await new Client(h.baseUrl).joinOrCreate(RoomName.Town, { idToken: `valid:${uid}` });
  h.rooms.push(room);
  const p: TownPlayer = {
    uid,
    room,
    corrections: inbox(room, ServerMessage.MoveCorrection),
    emotes: inbox(room, ServerMessage.Emote),
    intercom: inbox(room, ServerMessage.IntercomList),
    incoming: inbox(room, ServerMessage.VisitIncoming),
    status: inbox(room, ServerMessage.VisitStatus),
  };
  await new Promise<WelcomeMessage>((resolve) => room.onMessage(ServerMessage.Welcome, resolve));
  return p;
}

interface Apartment {
  room: Room;
  results: FurnitureResultMessage[];
  left: Promise<number>;
}

async function joinApartment(h: Harness, uid: string, owner: string): Promise<Apartment> {
  const room = await new Client(h.baseUrl).joinOrCreate(RoomName.Apartment, { idToken: `valid:${uid}`, owner });
  h.rooms.push(room);
  const results = inbox<FurnitureResultMessage>(room, ServerMessage.FurnitureResult);
  const left = new Promise<number>((resolve) => room.onLeave((code: number) => resolve(code)));
  await until(() => (room.state as Partial<ApartmentStateView>).layout !== undefined && (room.state as { layout: string }).layout !== "", "the layout");
  return { room, results, left };
}

const viewOf = (a: Apartment) => a.room.state as ApartmentStateView & { occupants: Map<string, ApartmentOccupantView> };
const occupantsOf = (a: Apartment): ApartmentOccupantView[] =>
  [...viewOf(a).occupants.values()].map(({ name, townSession, owner }) => ({ name, townSession, owner }));
const layoutOf = (a: Apartment) => JSON.parse(viewOf(a).layout) as ApartmentLayoutData;
const townView = (p: TownPlayer, sessionId: string) => (p.room.state as { players: Map<string, TownPlayerView> }).players.get(sessionId);

let editIds = 0;
async function edit(a: Apartment, e: Omit<FurnitureEditMessage, "editId"> & Record<string, unknown>): Promise<FurnitureResultMessage> {
  const editId = ++editIds;
  a.room.send(ClientMessage.FurnitureEdit, { ...e, editId });
  await until(() => a.results.some((r) => r.editId === editId), `the result of edit ${editId}`);
  return a.results.find((r) => r.editId === editId)!;
}

/** A client-side walker that reports to its TownRoom like the game client does. */
class Walker {
  readonly controller: PlayerController;
  seq = 0;
  epoch = 0;
  constructor(
    readonly player: TownPlayer,
    grids: SpaceGrids = spaceGrid,
  ) {
    this.controller = new PlayerController({ space: TOWN_SPAWN.space, pos: TOWN_SPAWN.pos, heading: TOWN_SPAWN.heading }, grids);
  }

  report(): void {
    const { space, pos, heading, motion } = this.controller.state;
    const move: PlayerMoveMessage = { seq: ++this.seq, epoch: this.epoch, space, x: pos[0], z: pos[1], heading, motion };
    this.player.room.send(ClientMessage.PlayerMove, move);
  }

  /** Applies server corrections and teleports (as the client's MoveSync does). */
  applyCorrections(): void {
    for (const c of this.player.corrections.splice(0)) {
      if (c.epoch <= this.epoch) continue;
      this.epoch = c.epoch;
      this.seq = 0;
      this.controller.teleport({ space: c.space, pos: [c.x, c.z], heading: c.heading });
    }
  }

  async walk(ms: number): Promise<void> {
    let last = performance.now();
    const end = last + ms;
    while (performance.now() < end) {
      await sleep(50);
      const now = performance.now();
      const door = this.controller.update((now - last) / 1000);
      last = now;
      if (door) {
        this.report();
        this.controller.completeTransition();
      }
      this.report();
    }
  }

  /** Click-to-move and walk until the path ends (or `space` is reached). */
  async walkTo(target: [number, number], space?: string): Promise<void> {
    expect(this.controller.clickTo(target)).toBe(true);
    for (let k = 0; k < 60; k++) {
      await this.walk(100);
      if (space ? this.controller.state.space === space : !this.controller.waypoints) break;
    }
    this.controller.setInput([0, 0]);
    await this.walk(100);
  }
}

/** Walks a player out of their apartment and up to the lobby intercom. */
async function walkToIntercom(w: Walker): Promise<void> {
  await w.walkTo(spaceDoors("apartment")[0]!.centre, "town");
  expect(w.controller.state.space).toBe("town");
  await w.walkTo(intercomInteractable().spot);
  expect(w.player.corrections).toEqual([]);
}

/** Bob rings Alice's apartment at the intercom; Alice answers. */
async function ring(alice: TownPlayer, bob: TownPlayer, accept: boolean): Promise<VisitStatusMessage> {
  const before = bob.status.length;
  bob.room.send(ClientMessage.VisitRequest, { sessionId: alice.room.sessionId });
  await until(() => alice.incoming.length > 0, "alice to hear the intercom");
  const request = alice.incoming.at(-1)!;
  expect(request).toMatchObject({ fromName: "Bob", fromApartment: "2B" });
  await until(() => bob.status.length > before, "bob to hear it ringing");
  expect(bob.status.at(-1)).toMatchObject({ requestId: request.requestId, state: "pending", ownerName: "Alice", apartmentId: "6D" });
  alice.room.send(ClientMessage.VisitAnswer, { requestId: request.requestId, accept });
  await until(() => bob.status.at(-1)?.state !== "pending", "bob to hear the answer");
  return bob.status.at(-1)!;
}

describe("ApartmentRoom: visits", () => {
  it("a friend rings at the intercom, is let in and sees the same furniture", async () => {
    const h = await start();
    const alice = await joinTown(h, "alice");
    const aliceHome = await joinApartment(h, "alice", "alice");
    // Her stored layout was loaded (not the starting furniture).
    expect(layoutOf(aliceHome)).toEqual(ALICE_LAYOUT);
    expect(viewOf(aliceHome)).toMatchObject({ owner: "alice", ownerName: "Alice", apartmentId: "6D", revision: 0 });
    expect(occupantsOf(aliceHome)).toEqual([{ name: "Alice", townSession: alice.room.sessionId, owner: true }]);

    const bob = await joinTown(h, "bob");
    // Nobody gets into someone else's apartment uninvited.
    await expect(joinApartment(h, "bob", "alice")).rejects.toThrow(/not invited/);

    const bobWalker = new Walker(bob);
    // The intercom only answers at the intercom.
    bob.room.send(ClientMessage.IntercomList, {});
    await sleep(150);
    expect(bob.intercom).toEqual([]);
    await walkToIntercom(bobWalker);
    bob.room.send(ClientMessage.IntercomList, {});
    await until(() => bob.intercom.length === 1, "the intercom list");
    expect(bob.intercom[0]!.players).toEqual([{ sessionId: alice.room.sessionId, name: "Alice", apartmentId: "6D", home: true }]);

    const status = await ring(alice, bob, true);
    expect(status).toMatchObject({ state: "accepted", host: "alice", ownerName: "Alice" });
    // The server walks Bob into Alice's apartment.
    await until(() => bob.corrections.some((c) => c.reason === "visit"), "the visit teleport");
    bobWalker.applyCorrections();
    expect(bobWalker.controller.state.space).toBe("apartment");
    await until(() => townView(alice, bob.room.sessionId)?.space === "apartment", "alice to see bob arrive");

    const bobVisit = await joinApartment(h, "bob", "alice");
    expect(viewOf(bobVisit).layout).toBe(viewOf(aliceHome).layout);
    expect(layoutOf(bobVisit)).toEqual(ALICE_LAYOUT);
    await until(() => viewOf(aliceHome).occupants.size === 2, "alice to see bob in the apartment");
    expect(occupantsOf(bobVisit).find((o) => !o.owner)).toEqual({ name: "Bob", townSession: bob.room.sessionId, owner: false });

    // Alice rearranges while Bob watches: he sees the same new layout.
    expect(await edit(aliceHome, { op: "move", index: BED, itemId: "bed", x: 2.5, z: 2, rot: 0 })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await edit(aliceHome, { op: "place", itemId: "wooden_chair", x: 4.5, z: 1, rot: 0 })).toEqual({ editId: editIds, ok: true });
    await until(() => viewOf(bobVisit).revision === 1, "bob to see the edit");
    expect(viewOf(bobVisit).layout).toBe(viewOf(aliceHome).layout);
    expect(layoutOf(bobVisit).furniture.at(-1)).toEqual({ itemId: "wooden_chair", x: 4.5, z: 1, rot: 0 });

    // Emotes in an apartment reach the people in it.
    alice.room.send(ClientMessage.Emote, { emote: "wave" });
    await until(() => bob.emotes.length === 1, "bob to see alice wave");

    // Bob leaves through the door: the visit ends and his pass with it.
    await bobWalker.walkTo(spaceDoors("apartment")[0]!.centre, "town");
    expect(bobWalker.controller.state.space).toBe("town");
    expect(await bobVisit.left).toBe(VISIT_ENDED_CODE);
    await until(() => viewOf(aliceHome).occupants.size === 1, "bob to leave the apartment");
    await expect(joinApartment(h, "bob", "alice")).rejects.toThrow(/not invited/);
  }, 30_000);

  it("a declined visit lets nobody in", async () => {
    const h = await start();
    const alice = await joinTown(h, "alice");
    const bob = await joinTown(h, "bob");
    await walkToIntercom(new Walker(bob));
    expect(await ring(alice, bob, false)).toMatchObject({ state: "declined", ownerName: "Alice" });
    expect(bob.corrections).toEqual([]);
    await expect(joinApartment(h, "bob", "alice")).rejects.toThrow(/not invited/);
    // A request to a player who is not in the shard goes nowhere.
    bob.room.send(ClientMessage.VisitRequest, { sessionId: "nobody" });
    await sleep(2100);
    bob.room.send(ClientMessage.VisitRequest, { sessionId: "nobody" });
    await until(() => bob.status.at(-1)?.state === "unavailable", "an unavailable status");
  }, 20_000);
});

describe("ApartmentRoom: furniture", () => {
  it("only the owner can edit, and only within the placement rules", async () => {
    const h = await start();
    const alice = await joinTown(h, "alice");
    const bob = await joinTown(h, "bob");
    const aliceHome = await joinApartment(h, "alice", "alice");
    await walkToIntercom(new Walker(bob));
    await ring(alice, bob, true);
    const bobVisit = await joinApartment(h, "bob", "alice");

    const move = { op: "move", index: CHAIR, itemId: "wooden_chair", x: 4.5, z: 1, rot: 0 } as const;
    expect(await edit(bobVisit, move)).toMatchObject({ ok: false, reason: "not_owner" });
    expect(await edit(bobVisit, { op: "store", index: BED, itemId: "bed" })).toMatchObject({ ok: false, reason: "not_owner" });
    expect(viewOf(aliceHome).revision).toBe(0);
    // The owner's edits obey the shared rules: no built-ins, no overlaps, no stale indexes.
    expect(await edit(aliceHome, { op: "store", index: 6, itemId: "mirror" })).toMatchObject({ ok: false, reason: "fixed" });
    expect(await edit(aliceHome, { op: "move", index: CHAIR, itemId: "small_table", x: 4.5, z: 1, rot: 0 })).toMatchObject({ ok: false, reason: "not_found" });
    const overlap = await edit(aliceHome, { op: "move", index: 8, itemId: "small_table", x: 4.5, z: 0, rot: 0 });
    expect(overlap).toMatchObject({ ok: false, reason: "invalid" });
    expect(overlap.problems!.join()).toMatch(/overlaps/);
    // Malformed edits are dropped without an answer.
    aliceHome.room.send(ClientMessage.FurnitureEdit, { op: "move", editId: 999, index: CHAIR, itemId: "throne", x: 1, z: 1, rot: 0 });
    await sleep(150);
    expect(aliceHome.results.some((r) => r.editId === 999)).toBe(false);
    expect(viewOf(aliceHome).revision).toBe(0);
    expect(viewOf(bobVisit).layout).toBe(JSON.stringify(ALICE_LAYOUT));
    await sleep(100);
    expect(h.layouts.saves).toBe(0);
  }, 20_000);

  it("persists layout edits: a new instance of the room loads them", async () => {
    const h = await start();
    await joinTown(h, "carol");
    const home = await joinApartment(h, "carol", "carol");
    // Carol never decorated: the starting furniture, and nothing stored yet.
    expect(layoutOf(home)).toEqual(defaultApartmentLayout());
    expect(await h.layouts.getLayout("carol")).toBeNull();

    expect(await edit(home, { op: "move", index: CHAIR, itemId: "wooden_chair", x: 4.5, z: 1, rot: 180 })).toMatchObject({ ok: true });
    expect(await edit(home, { op: "store", index: 2, itemId: "painting" })).toMatchObject({ ok: true });
    await until(() => viewOf(home).revision === 2, "both edits in the state");
    const expected = layoutOf(home);
    expect(expected.stored).toEqual(["painting"]);
    // Saved (debounced) through the layout store, i.e. users/carol/apartment/layout.
    await until(() => h.layouts.layouts.get("carol") !== undefined && h.layouts.layouts.get("carol")!.stored.length === 1, "the save");
    expect(await h.layouts.getLayout("carol")).toEqual(expected);

    // Everyone leaves; the room closes; Carol comes back to the same furniture.
    await home.room.leave();
    await until(() => h.server.apartments.room("carol") === undefined, "the apartment room to close", 5000);
    const again = await joinApartment(h, "carol", "carol");
    expect(layoutOf(again)).toEqual(expected);
    expect(viewOf(again).revision).toBe(0);
  }, 20_000);

  it("validates movement inside the apartment against the owner's furniture", async () => {
    const h = await start();
    const alice = await joinTown(h, "alice");
    const home = await joinApartment(h, "alice", "alice");
    // Alice puts her bed away; the floor where it stood is free to walk on.
    expect(await edit(home, { op: "store", index: BED, itemId: "bed" })).toMatchObject({ ok: true });
    await until(() => viewOf(home).revision === 1, "the edit in the state");
    const layout = layoutOf(home);
    expect(layout.stored).toEqual(["wooden_chair", "bed"]);
    const walker = new Walker(alice, (space) => (space === "apartment" ? apartmentNavGrid(layout) : spaceGrid(space)));
    await walker.walkTo([5.5, 1]);
    expect(Math.hypot(walker.controller.state.pos[0] - 5.5, walker.controller.state.pos[1] - 1)).toBeLessThan(0.1);
    // The static studio grid has the bed there, so the server checked the stored layout.
    expect(alice.corrections).toEqual([]);
    const me = () => townView(alice, alice.room.sessionId)!;
    await until(() => Math.abs(me().x - 5.5) < 0.1 && Math.abs(me().z - 1) < 0.1, "the server to accept the position");
  }, 20_000);
});
