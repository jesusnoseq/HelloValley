import { type Client, Room, ServerError } from "@colyseus/core";
import {
  appearanceOf,
  ClientMessage,
  type ClientMessagePayloads,
  createMoveTracker,
  type EmoteBroadcast,
  interiorArrivalPoint,
  isPrivateSpace,
  isSpaceId,
  JoinOptionsSchema,
  type MoveCorrectionMessage,
  type MoveTracker,
  parseClientMessage,
  ServerMessage,
  SESSION_REPLACED_CODE,
  type SpacePoint,
  type TimeSyncReply,
  type UserProfile,
  validateMove,
  WEATHER_SLOT_MS,
  weatherAt,
  type WelcomeMessage,
  WORLD_WEATHER_SEED,
  worldDayAt,
} from "@hellovalley/shared";
import { type IdTokenVerifier, InvalidIdTokenError, type VerifiedUser } from "../auth/idToken";
import type { ProfileStore } from "../profiles/profileStore";
import { type RegisteredTown, TownRegistry } from "./townRegistry";
import { TownPlayer, TownState, TownWorld } from "./TownState";

/** GDD §4.4 / architecture §7.1: up to 40 players per shard. */
export const TOWN_MAX_CLIENTS = 40;
/** Where a joining player appears: inside their own apartment (build plan M14). */
export const TOWN_SPAWN: SpacePoint = interiorArrivalPoint("apartment");
/** How often the world clock and weather in the state refresh. */
export const WORLD_TICK_MS = 1000;
/** Shortest gap between two emotes of one player. */
export const EMOTE_COOLDOWN_MS = 600;
/** A dropped connection keeps its seat (and position) this long for the SDK to reconnect. */
export const RECONNECT_SECONDS = 20;

/** What `onAuth` returns; Colyseus keeps it on `client.auth`. */
export interface TownAuth {
  uid: string;
  profile: UserProfile;
}

export type TownClient = Client<{ auth: TownAuth }>;

/** Rejects every token. Real rooms are created through `townRoomWith(verifier)`. */
const denyAll: IdTokenVerifier = {
  verify: () => Promise.reject(new InvalidIdTokenError()),
};

/** Knows no profiles, so nobody counts as onboarded. */
const noProfiles: ProfileStore = {
  getProfile: () => Promise.resolve(null),
  createProfile: () => Promise.reject(new Error("no profile store")),
  updateAppearance: () => Promise.resolve(null),
};

/** Server-only bookkeeping for one session. */
interface Session {
  uid: string;
  tracker: MoveTracker;
  /** Highest `seq` seen in this epoch. */
  seq: number;
  /** Bumped on every correction; reports from older epochs are ignored. */
  epoch: number;
  lastEmoteMs: number;
}

function wrapAngle(a: number): number {
  const w = Math.atan2(Math.sin(a), Math.cos(a));
  return Number.isFinite(w) ? w : 0;
}

/**
 * One town shard ("Valley #n", build plan M16, GDD §4.4). Joining needs a valid Firebase ID token
 * and a finished onboarding; the verified uid is the player's identity, and a newer session of
 * the same uid replaces an older one. The room is authoritative for positions: clients predict
 * their own walker and report it (`player:move`), the room validates each report with the shared
 * `validateMove` (speed cap, walkability grids, doors) and corrects rejected ones. The state
 * carries every player's position, motion, name and look, plus the world clock and weather.
 * Every client message is validated against the shared zod schemas and invalid ones are dropped.
 */
export class TownRoom extends Room<{ state: TownState; client: TownClient }> implements RegisteredTown {
  override maxClients = TOWN_MAX_CLIENTS;
  override state = new TownState();
  protected verifier: IdTokenVerifier = denyAll;
  protected profiles: ProfileStore = noProfiles;
  protected registry: TownRegistry = new TownRegistry();
  private readonly sessions = new Map<string, Session>();
  /** Sessions a newer tab replaced: they may not reconnect. */
  private readonly replaced = new Set<string>();

  get shard(): number {
    return this.state.shard;
  }

  get clientCount(): number {
    return this.clients.length;
  }

  get maxClientCount(): number {
    return this.maxClients;
  }

  override onCreate(): void {
    this.state.shard = this.registry.claimShard();
    this.state.world = new TownWorld();
    this.tickWorld();
    // The matchmaker fills the lowest-numbered shard with a free seat first (server.ts sortBy).
    void this.setMetadata({ shard: this.state.shard });
    this.registry.addTown(this);
    this.clock.setInterval(() => this.tickWorld(), WORLD_TICK_MS);

    this.handle(ClientMessage.PlayerMove, (client, move) => this.onMove(client, move));
    this.handle(ClientMessage.Emote, (client, { emote }) => this.onEmote(client, emote));
    this.handle(ClientMessage.TimeSync, (client, { t }) => {
      // TODO(M36): rate-limit probes with the other per-client limits.
      const reply: TimeSyncReply = { t, server: Date.now() };
      client.send(ServerMessage.TimeSync, reply);
    });
    this.handle(ClientMessage.Chat, (_client, _chat) => {
      // TODO(M18): mandatory server moderation, then proximity broadcast.
    });
    this.handle(ClientMessage.Interact, (_client, _request) => {
      // TODO(M19/M21): range check and NPC conversation start (turnId issue, architecture §9).
    });
  }

  override async onAuth(_client: TownClient, options: unknown): Promise<TownAuth> {
    const parsed = JoinOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) throw new ServerError(400, "invalid join options");
    let user: VerifiedUser;
    try {
      user = await this.verifier.verify(parsed.data.idToken);
    } catch {
      throw new ServerError(401, "invalid ID token");
    }
    // Architecture §7.1: players who have not finished onboarding (no users/{uid}) cannot join.
    let profile: UserProfile | null;
    try {
      profile = await this.profiles.getProfile(user.uid);
    } catch (err) {
      console.error(`[town] profile lookup failed for ${user.uid}:`, err);
      throw new ServerError(503, "profile unavailable");
    }
    if (!profile) throw new ServerError(403, "onboarding required");
    return { uid: user.uid, profile };
  }

  override onJoin(client: TownClient): void {
    const { uid, profile } = client.auth!;
    const now = Date.now();
    this.sessions.set(client.sessionId, { uid, tracker: createMoveTracker(TOWN_SPAWN, now), seq: -1, epoch: 0, lastEmoteMs: 0 });
    this.state.players.set(
      client.sessionId,
      new TownPlayer({
        name: profile.name,
        appearance: JSON.stringify(appearanceOf(profile)),
        space: TOWN_SPAWN.space,
        x: TOWN_SPAWN.pos[0],
        z: TOWN_SPAWN.pos[1],
        heading: TOWN_SPAWN.heading,
        motion: "idle",
      }),
    );
    // One session per uid: an older tab (in any shard) is disconnected.
    this.registry.bindSession(uid, this, client.sessionId);
    const welcome: WelcomeMessage = {
      uid,
      shard: this.state.shard,
      spawn: { space: TOWN_SPAWN.space, x: TOWN_SPAWN.pos[0], z: TOWN_SPAWN.pos[1], heading: TOWN_SPAWN.heading },
    };
    client.send(ServerMessage.Welcome, welcome);
  }

  override onDrop(client: TownClient, code?: number): void {
    if (this.replaced.has(client.sessionId) || code === SESSION_REPLACED_CODE) return;
    const player = this.state.players.get(client.sessionId);
    if (player) player.motion = "idle";
    // A brief network drop keeps the seat and position; onLeave follows if it times out.
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onReconnect(client: TownClient): void {
    if (this.replaced.has(client.sessionId)) client.leave(SESSION_REPLACED_CODE, "session replaced");
  }

  override onLeave(client: TownClient): void {
    const session = this.sessions.get(client.sessionId);
    if (session) this.registry.unbindSession(session.uid, client.sessionId);
    this.sessions.delete(client.sessionId);
    this.replaced.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  override onDispose(): void {
    this.registry.removeTown(this);
    this.registry.releaseShard(this.state.shard);
  }

  /** RegisteredTown: a newer session of the same uid joined, so this one goes. */
  replaceSession(sessionId: string): void {
    this.replaced.add(sessionId);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.leave(SESSION_REPLACED_CODE, "session replaced");
  }

  /** RegisteredTown: a saved mirror edit (or rename) shows on the player's avatar for everyone. */
  applyProfile(uid: string, profile: UserProfile): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.uid !== uid) continue;
      const player = this.state.players.get(sessionId);
      if (!player) continue;
      player.name = profile.name;
      player.appearance = JSON.stringify(appearanceOf(profile));
    }
  }

  private onMove(client: TownClient, move: ClientMessagePayloads[typeof ClientMessage.PlayerMove]): void {
    const session = this.sessions.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!session || !player) return;
    // Reports sent before the client applied the latest correction, or replayed, are stale.
    if (move.epoch !== session.epoch || move.seq <= session.seq) return;
    session.seq = move.seq;
    const verdict = validateMove(session.tracker, { space: move.space, pos: [move.x, move.z], heading: move.heading }, Date.now());
    if (!verdict.ok) {
      // TODO(M36): count rejections per session (speed hacks) toward a kick.
      session.epoch++;
      session.seq = -1;
      const t = session.tracker;
      player.motion = "idle";
      const correction: MoveCorrectionMessage = { epoch: session.epoch, space: t.space, x: t.pos[0], z: t.pos[1], heading: t.heading, reason: verdict.reason };
      client.send(ServerMessage.MoveCorrection, correction);
      return;
    }
    player.space = move.space;
    player.x = move.x;
    player.z = move.z;
    player.heading = wrapAngle(move.heading);
    player.motion = move.motion;
  }

  private onEmote(client: TownClient, emote: EmoteBroadcast["emote"]): void {
    const session = this.sessions.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!session || !player) return;
    const now = Date.now();
    // Emotes play only while standing (the shared AnimationStateMachine refuses them otherwise).
    if (now - session.lastEmoteMs < EMOTE_COOLDOWN_MS || player.motion !== "idle") return;
    session.lastEmoteMs = now;
    if (!isSpaceId(player.space) || isPrivateSpace(player.space)) return;
    const message: EmoteBroadcast = { sessionId: client.sessionId, emote };
    for (const other of this.clients) {
      if (other === client) continue;
      if (this.state.players.get(other.sessionId)?.space === player.space) other.send(ServerMessage.Emote, message);
    }
  }

  /** Refreshes the clock and weather in the state (wall time: survives restarts, architecture §3.1). */
  private tickWorld(): void {
    const now = Date.now();
    const weather = weatherAt(now, WORLD_WEATHER_SEED);
    const world = this.state.world;
    world.serverTime = now;
    world.day = worldDayAt(now);
    world.weather = weather.weather;
    world.previousWeather = weather.previous;
    world.weatherSince = weather.slot * WEATHER_SLOT_MS;
  }

  /** Registers a handler that only ever sees payloads that passed the shared schema. */
  private handle<K extends ClientMessage>(
    type: K,
    handler: (client: TownClient, payload: ClientMessagePayloads[K]) => void,
  ): void {
    this.onMessage(type, (client: TownClient, payload: unknown) => {
      const result = parseClientMessage(type, payload);
      if (!result.ok) {
        // TODO(M36): count invalid messages toward the per-client rate limit.
        console.warn(`[town ${this.roomId}] dropped invalid "${type}" from ${client.sessionId}: ${result.error}`);
        return;
      }
      handler(client, result.value);
    });
  }
}

export interface TownRoomOptions {
  /** Seats per shard (default TOWN_MAX_CLIENTS; tests use small shards). */
  maxClients?: number;
}

/** A TownRoom class bound to the verifier, the profile store and the registry, for `server.define`. */
export function townRoomWith(
  verifier: IdTokenVerifier,
  profiles: ProfileStore,
  registry: TownRegistry = new TownRegistry(),
  options: TownRoomOptions = {},
): typeof TownRoom {
  return class extends TownRoom {
    override maxClients = options.maxClients ?? TOWN_MAX_CLIENTS;
    protected override verifier = verifier;
    protected override profiles = profiles;
    protected override registry = registry;
  };
}
