import type { AddressInfo } from "node:net";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ApiRoute,
  ClientMessage,
  ClockSync,
  type EmoteBroadcast,
  type MoveCorrectionMessage,
  PlayerController,
  type PlayerMoveMessage,
  RoomName,
  ServerMessage,
  SESSION_REPLACED_CODE,
  type ShardsResponse,
  spaceDoors,
  type TimeSyncReply,
  type TownPlayerView,
  type TownWorldView,
  type UserProfile,
  weatherAt,
  type WelcomeMessage,
  WORLD_WEATHER_SEED,
  worldDayAt,
  worldPhaseAt,
} from "@hellovalley/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { IdTokenVerifier } from "../auth/idToken";
import { InvalidIdTokenError } from "../auth/idToken";
import { createMemoryProfileStore } from "../profiles/profileStore";
import { createGameServer, type GameServer, type GameServerOptions } from "../server";
import { TOWN_MAX_CLIENTS, TOWN_SPAWN } from "./TownRoom";

/**
 * Multi-client TownRoom tests (build plan M16) with the real Colyseus SDK in Node. Auth is mocked:
 * tokens look like `valid:<uid>` and every uid has a finished profile.
 */

const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const profileOf = (name: string): UserProfile => ({
  name,
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "6D",
  nativeLang: "en",
  targetLangs: ["ja"],
  style: "japanese",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});

/** Everyone from u1 to u60, plus alice and bob, has finished onboarding. */
function onboardedProfiles() {
  const all: Record<string, UserProfile> = { alice: profileOf("Alice"), bob: profileOf("Bob") };
  for (let k = 1; k <= 60; k++) all[`u${k}`] = profileOf(`Player ${k}`);
  return createMemoryProfileStore(all);
}

interface Harness {
  server: GameServer;
  baseUrl: string;
  rooms: Room[];
}

let harness: Harness | null = null;

async function start(options: Partial<GameServerOptions> = {}): Promise<Harness> {
  const server = createGameServer({ verifier: fakeVerifier, profiles: onboardedProfiles(), ...options });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  harness = { server, baseUrl: `http://127.0.0.1:${port}`, rooms: [] };
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

/** Polls until `check` holds (state patches arrive at 20 Hz). */
async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

interface Player {
  room: Room;
  welcome: WelcomeMessage;
  corrections: MoveCorrectionMessage[];
  emotes: EmoteBroadcast[];
}

/** Joins as `uid` (joinOrCreate, or a given room id) and waits for the welcome. */
async function join(h: Harness, uid: string, roomId?: string): Promise<Player> {
  const client = new Client(h.baseUrl);
  const options = { idToken: `valid:${uid}` };
  const room = roomId ? await client.joinById(roomId, options) : await client.joinOrCreate(RoomName.Town, options);
  h.rooms.push(room);
  const corrections: MoveCorrectionMessage[] = [];
  const emotes: EmoteBroadcast[] = [];
  room.onMessage(ServerMessage.MoveCorrection, (m: MoveCorrectionMessage) => corrections.push(m));
  room.onMessage(ServerMessage.Emote, (m: EmoteBroadcast) => emotes.push(m));
  const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(ServerMessage.Welcome, resolve));
  return { room, welcome, corrections, emotes };
}

const playerIn = (p: Player, sessionId: string): TownPlayerView | undefined =>
  (p.room.state as { players?: Map<string, TownPlayerView> }).players?.get(sessionId);

/** A client-side walker that reports to the room like the game client does. */
class Walker {
  readonly controller = new PlayerController({ space: TOWN_SPAWN.space, pos: TOWN_SPAWN.pos, heading: TOWN_SPAWN.heading });
  seq = 0;
  epoch = 0;
  constructor(readonly player: Player) {}

  report(): void {
    const { space, pos, heading, motion } = this.controller.state;
    const move: PlayerMoveMessage = { seq: ++this.seq, epoch: this.epoch, space, x: pos[0], z: pos[1], heading, motion };
    this.player.room.send(ClientMessage.PlayerMove, move);
  }

  /** Walks in real time for `ms`, reporting every 50 ms and going through doors at once. */
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
}

/** Walks a fresh player out of their apartment into the town. */
async function walkIntoTown(w: Walker): Promise<void> {
  expect(w.controller.clickTo(spaceDoors("apartment")[0]!.centre)).toBe(true);
  for (let k = 0; k < 40 && w.controller.state.space !== "town"; k++) await w.walk(100);
  expect(w.controller.state.space).toBe("town");
  w.controller.setInput([0, 0]);
  await w.walk(100);
}

describe("TownRoom: movement", () => {
  it("two clients see each other move, validated by the server", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    expect(alice.welcome.shard).toBe(bob.welcome.shard);
    expect(alice.welcome.spawn).toMatchObject({ space: "apartment" });

    const aliceWalker = new Walker(alice);
    const bobWalker = new Walker(bob);
    await Promise.all([walkIntoTown(aliceWalker), walkIntoTown(bobWalker)]);

    // Bob's mirror of the room sees Alice in town, where she really is.
    const aliceId = alice.room.sessionId;
    await until(() => playerIn(bob, aliceId)?.space === "town", "bob to see alice in town");
    // Every x Bob receives for Alice while she walks east.
    const seen: number[] = [];
    Callbacks.get(bob.room).listen(bob.room.state.players.get(aliceId), "x", (x: number) => seen.push(x));
    aliceWalker.controller.setInput([1, 0]);
    await aliceWalker.walk(600);
    aliceWalker.controller.setInput([0, 0]);
    await aliceWalker.walk(100);
    const target = aliceWalker.controller.state.pos;
    // Positions are synced as 32-bit floats.
    await until(
      () => Math.abs(playerIn(bob, aliceId)!.x - target[0]) < 1e-4 && playerIn(bob, aliceId)!.motion === "idle",
      "bob to see alice stop at her last position",
    );
    expect(playerIn(bob, aliceId)!.z).toBeCloseTo(target[1], 4);
    // Several intermediate positions arrived (smooth interpolation needs a stream, not one jump).
    expect(new Set(seen).size).toBeGreaterThanOrEqual(4);
    expect(alice.corrections).toEqual([]);
    expect(bob.corrections).toEqual([]);
    // Alice also sees Bob, and the appearance and name came from the profile.
    const bobView = playerIn(alice, bob.room.sessionId)!;
    expect(bobView.name).toBe("Bob");
    expect(JSON.parse(bobView.appearance)).toMatchObject({ animal: "fox" });

    // Emotes: relayed to players in the same space while standing still.
    alice.room.send(ClientMessage.Emote, { emote: "wave" });
    await until(() => bob.emotes.length === 1, "bob to see alice's wave");
    expect(bob.emotes[0]).toEqual({ sessionId: aliceId, emote: "wave" });
    expect(alice.emotes).toEqual([]);
  }, 20_000);

  it("rejects a speed hack and corrects the client to its last valid position", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    const [x0, z0] = TOWN_SPAWN.pos;
    // Inside the apartment: bounce 0.6 m back and forth far faster than anyone can run.
    let seq = 0;
    const send = (x: number, epoch = 0) =>
      alice.room.send(ClientMessage.PlayerMove, { seq: ++seq, epoch, space: "apartment", x, z: z0, heading: 0, motion: "run" });
    for (let k = 0; k < 20; k++) send(k % 2 === 0 ? x0 + 0.6 : x0);
    await until(() => alice.corrections.length > 0, "a correction");
    const c = alice.corrections[0]!;
    expect(c).toMatchObject({ epoch: 1, reason: "speed", space: "apartment", z: z0 });
    expect([x0, x0 + 0.6].some((x) => Math.abs(c.x - x) < 1e-9)).toBe(true);
    // Only one correction: later reports from the old epoch are ignored, not corrected again.
    await sleep(150);
    expect(alice.corrections).toHaveLength(1);
    // Positions are synced as 32-bit floats.
    const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-4;
    await until(() => near(playerIn(bob, alice.room.sessionId)?.x, c.x), "bob to see the corrected position");
    // Reports from the stale epoch change nothing; the new epoch is accepted again.
    send(c.x === x0 ? x0 + 0.3 : x0, 0);
    await sleep(150);
    expect(near(playerIn(bob, alice.room.sessionId)!.x, c.x)).toBe(true);
    seq = 0;
    send(c.x + 0.1, 1);
    await until(() => near(playerIn(bob, alice.room.sessionId)?.x, c.x + 0.1), "the new epoch to be accepted");
    expect(alice.corrections).toHaveLength(1);
  });

  it("rejects walking through walls and leaving a space away from its door", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const [x0, z0] = TOWN_SPAWN.pos;
    // Straight into the town from the middle of the apartment.
    alice.room.send(ClientMessage.PlayerMove, { seq: 1, epoch: 0, space: "town", x: 20, z: 20, heading: 0, motion: "walk" });
    await until(() => alice.corrections.length === 1, "a space correction");
    expect(alice.corrections[0]).toMatchObject({ epoch: 1, reason: "space", space: "apartment", x: x0, z: z0 });
    // Through the apartment wall (well within the speed budget).
    alice.room.send(ClientMessage.PlayerMove, { seq: 1, epoch: 1, space: "apartment", x: x0, z: z0 - 3, heading: 0, motion: "walk" });
    alice.room.send(ClientMessage.PlayerMove, { seq: 2, epoch: 1, space: "apartment", x: x0 - 12, z: z0, heading: 0, motion: "walk" });
    await until(() => alice.corrections.length === 2, "a walkability correction");
    expect(alice.corrections[1]).toMatchObject({ epoch: 2, space: "apartment" });
    expect(["blocked", "speed"]).toContain(alice.corrections[1]!.reason);
  });
});

describe("TownRoom: shards", () => {
  it(`opens a new shard when ${TOWN_MAX_CLIENTS} players are in the first`, async () => {
    const h = await start();
    const players: Player[] = [];
    for (let k = 1; k <= TOWN_MAX_CLIENTS + 1; k++) players.push(await join(h, `u${k}`));
    const shards = players.map((p) => p.welcome.shard);
    expect(shards.slice(0, TOWN_MAX_CLIENTS).every((s) => s === 1)).toBe(true);
    expect(shards[TOWN_MAX_CLIENTS]).toBe(2);
    expect(h.server.towns.list().map((s) => [s.shard, s.clients])).toEqual([
      [1, TOWN_MAX_CLIENTS],
      [2, 1],
    ]);
  }, 30_000);

  it("fills the lowest shard first and joins a friend's shard by uid", async () => {
    const h = await start({ town: { maxClients: 2 } });
    const u1 = await join(h, "u1");
    const u2 = await join(h, "u2");
    const u3 = await join(h, "u3");
    expect([u1.welcome.shard, u2.welcome.shard, u3.welcome.shard]).toEqual([1, 1, 2]);

    // A seat frees up in shard 1: normal matchmaking takes it.
    await u2.room.leave();
    await until(() => h.server.towns.list()[0]?.clients === 1, "shard 1 to have a free seat");
    const u4 = await join(h, "u4");
    expect(u4.welcome.shard).toBe(1);

    // u5 wants to play with u3: look the friend up over HTTP, then join that shard by id.
    const res = await fetch(`${h.baseUrl}${ApiRoute.Shards}?friend=u3`, { headers: { authorization: "Bearer valid:u5" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShardsResponse;
    expect(body.friend).toMatchObject({ shard: 2, clients: 1, maxClients: 2 });
    expect(body.shards.map((s) => s.shard)).toEqual([1, 2]);
    const u5 = await join(h, "u5", body.friend!.roomId);
    expect(u5.welcome.shard).toBe(2);

    // A full friend's shard cannot be joined by id (the client falls back to matchmaking).
    await expect(join(h, "u6", body.friend!.roomId)).rejects.toThrow();
    // Unknown or offline friends and malformed uids.
    const offline = await fetch(`${h.baseUrl}${ApiRoute.Shards}?friend=nobody`, { headers: { authorization: "Bearer valid:u5" } });
    expect(((await offline.json()) as ShardsResponse).friend).toBeNull();
    const bad = await fetch(`${h.baseUrl}${ApiRoute.Shards}?friend=a%2Fb`, { headers: { authorization: "Bearer valid:u5" } });
    expect(bad.status).toBe(400);
    expect((await fetch(`${h.baseUrl}${ApiRoute.Shards}`)).status).toBe(401);
  }, 20_000);

  it("keeps one session per uid: a second tab replaces the first", async () => {
    const h = await start();
    const first = await join(h, "alice");
    const left = new Promise<number>((resolve) => first.room.onLeave((code: number) => resolve(code)));
    const second = await join(h, "alice");
    expect(await left).toBe(SESSION_REPLACED_CODE);
    await until(() => !playerIn(second, first.room.sessionId), "the old session to leave the state");
    expect(playerIn(second, second.room.sessionId)).toBeDefined();
    expect(h.server.towns.shardOf("alice")?.clients).toBe(1);
  });
});

describe("TownRoom: world clock and profile", () => {
  it("syncs the world clock and broadcasts the weather", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    const syncOf = async (p: Player) => {
      const sync = new ClockSync();
      for (let k = 0; k < 3; k++) {
        const sentMs = Date.now();
        const reply = await new Promise<TimeSyncReply>((resolve) => {
          const off = p.room.onMessage(ServerMessage.TimeSync, (m: TimeSyncReply) => {
            off();
            resolve(m);
          });
          p.room.send(ClientMessage.TimeSync, { t: sentMs });
        });
        expect(reply.t).toBe(sentMs);
        expect(sync.add({ sentMs: reply.t, serverMs: reply.server, receivedMs: Date.now() })).toBe(true);
      }
      return sync;
    };
    const [a, b] = await Promise.all([syncOf(alice), syncOf(bob)]);
    const now = Date.now();
    // Same machine: the estimated server clock is within a round trip of the local one.
    expect(Math.abs(a.serverTime(now) - now)).toBeLessThan(250);
    // Both clients compute the same time of day (within a second of the 40-minute cycle).
    expect(Math.abs(worldPhaseAt(a.serverTime(now)) - worldPhaseAt(b.serverTime(now)))).toBeLessThan(1000 / (40 * 60 * 1000));

    const world = (alice.room.state as { world: TownWorldView }).world;
    expect(Math.abs(world.serverTime - Date.now())).toBeLessThan(2000);
    expect(world.day).toBe(worldDayAt(world.serverTime));
    const expected = weatherAt(world.serverTime, WORLD_WEATHER_SEED);
    expect(world.weather).toBe(expected.weather);
    expect(world.previousWeather).toBe(expected.previous);
    const first = world.serverTime;
    await until(() => world.serverTime > first, "the clock tick", 2500);
  });

  it("shows a saved mirror edit to everyone in the room", async () => {
    const h = await start();
    const alice = await join(h, "alice");
    const bob = await join(h, "bob");
    const res = await fetch(`${h.baseUrl}${ApiRoute.Appearance}`, {
      method: "PUT",
      headers: { authorization: "Bearer valid:alice", "content-type": "application/json" },
      body: JSON.stringify({ animal: "cat", colors: { fur: "ginger", shirt: { swatch: "coral" }, trousers: { swatch: "navy" } } }),
    });
    expect(res.status).toBe(200);
    await until(() => JSON.parse(playerIn(bob, alice.room.sessionId)?.appearance ?? "{}").animal === "cat", "bob to see the new look");
  });
});
