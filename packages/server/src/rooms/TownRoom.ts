import { randomUUID } from "node:crypto";
import { type Client, type Delayed, Room, ServerError } from "@colyseus/core";
import {
  appearanceOf,
  ClientMessage,
  type ClientMessagePayloads,
  createMoveTracker,
  type EmoteBroadcast,
  type IntercomEntry,
  type IntercomListMessage,
  intercomInteractable,
  interiorArrivalPoint,
  isPrivateSpace,
  isSpaceId,
  JoinOptionsSchema,
  type MoveCorrectionMessage,
  type MoveTracker,
  parseClientMessage,
  resetMoveTracker,
  ServerMessage,
  SESSION_REPLACED_CODE,
  type SpaceGrids,
  spaceGrid,
  type SpacePoint,
  type TimeSyncReply,
  type UserProfile,
  validateMove,
  type VisitClosedMessage,
  type VisitIncomingMessage,
  type VisitState,
  type VisitStatusMessage,
  WEATHER_SLOT_MS,
  weatherAt,
  type WelcomeMessage,
  WORLD_WEATHER_SEED,
  worldDayAt,
} from "@hellovalley/shared";
import { type IdTokenVerifier, InvalidIdTokenError, type VerifiedUser } from "../auth/idToken";
import type { ProfileStore } from "../profiles/profileStore";
import { ApartmentRegistry } from "./apartmentRegistry";
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
/** An unanswered visit request expires after this long (my number). */
export const VISIT_REQUEST_TTL_MS = 30_000;
/** Shortest gap between two visit requests of one player (no ringing every doorbell at once). */
export const VISIT_REQUEST_COOLDOWN_MS = 2000;
/** Slack on the intercom's reach for the server check (reports lag the client a little). */
export const INTERCOM_REACH_SLACK_M = 0.5;

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
  name: string;
  apartmentId: string;
  /**
   * Whose apartment the player is in while in the `apartment` space: their own uid (they came in
   * through the apartment block door) or the host of an accepted visit (build plan M17).
   */
  apartmentHost: string | null;
  lastVisitRequestMs: number;
}

/** A visit request rung at the lobby intercom, waiting for the owner's answer. */
interface PendingVisit {
  id: string;
  visitor: string;
  owner: string;
  timer: Delayed;
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
  protected apartments: ApartmentRegistry = new ApartmentRegistry();
  private readonly sessions = new Map<string, Session>();
  private readonly visits = new Map<string, PendingVisit>();
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
    this.handle(ClientMessage.IntercomList, (client) => this.onIntercomList(client));
    this.handle(ClientMessage.VisitRequest, (client, { sessionId }) => this.onVisitRequest(client, sessionId));
    this.handle(ClientMessage.VisitAnswer, (client, { requestId, accept }) => this.onVisitAnswer(client, requestId, accept));
    this.handle(ClientMessage.FurnitureEdit, () => {
      // Furniture edits belong to the ApartmentRoom.
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
    this.sessions.set(client.sessionId, {
      uid,
      tracker: createMoveTracker(TOWN_SPAWN, now),
      seq: -1,
      epoch: 0,
      lastEmoteMs: 0,
      name: profile.name,
      apartmentId: profile.apartmentId,
      apartmentHost: TOWN_SPAWN.space === "apartment" ? uid : null,
      lastVisitRequestMs: Number.NEGATIVE_INFINITY,
    });
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
    if (session) {
      this.registry.unbindSession(session.uid, client.sessionId);
      this.leaveApartment(session);
    }
    for (const visit of [...this.visits.values()]) {
      if (visit.visitor === client.sessionId || visit.owner === client.sessionId) this.closeVisit(visit, "unavailable");
    }
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
      session.name = profile.name;
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
    // Inside an apartment, walkability follows that apartment's furniture (its ApartmentRoom).
    const grids: SpaceGrids = (space) =>
      space === "apartment" ? this.apartments.gridFor(session.apartmentHost ?? session.uid) : spaceGrid(space);
    const from = session.tracker.space;
    const verdict = validateMove(session.tracker, { space: move.space, pos: [move.x, move.z], heading: move.heading }, Date.now(), grids);
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
    if (verdict.door) {
      // The apartment block door always leads home; walking out ends a visit.
      if (move.space === "apartment") session.apartmentHost = session.uid;
      else if (from === "apartment") this.leaveApartment(session);
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
    if (!isSpaceId(player.space)) return;
    // In an apartment only the people in that same apartment see it.
    const host = isPrivateSpace(player.space) ? session.apartmentHost : null;
    const message: EmoteBroadcast = { sessionId: client.sessionId, emote };
    for (const other of this.clients) {
      if (other === client) continue;
      if (this.state.players.get(other.sessionId)?.space !== player.space) continue;
      if (host !== null && this.sessions.get(other.sessionId)?.apartmentHost !== host) continue;
      other.send(ServerMessage.Emote, message);
    }
  }

  /** The player left the apartment space (or the town): a visit ends there. */
  private leaveApartment(session: Session): void {
    const host = session.apartmentHost;
    session.apartmentHost = null;
    if (host && host !== session.uid) this.apartments.endVisit(host, session.uid);
  }

  // -------------------------------------------------------------------------------------------
  // Lobby intercom and visits (build plan M17, GDD §4.2)

  /** Whether the session's server-side walker stands at the lobby intercom. */
  private atIntercom(session: Session): boolean {
    const intercom = intercomInteractable();
    const t = session.tracker;
    const d = Math.hypot(t.pos[0] - intercom.spot[0], t.pos[1] - intercom.spot[1]);
    return t.space === "town" && d <= intercom.radius + INTERCOM_REACH_SLACK_M;
  }

  /** The intercom lists everyone else online in this shard. */
  private onIntercomList(client: TownClient): void {
    const session = this.sessions.get(client.sessionId);
    if (!session || !this.atIntercom(session)) return;
    const players: IntercomEntry[] = [];
    for (const [sessionId, other] of this.sessions) {
      if (sessionId === client.sessionId) continue;
      const home = this.state.players.get(sessionId)?.space === "apartment" && other.apartmentHost === other.uid;
      players.push({ sessionId, name: other.name, apartmentId: other.apartmentId, home });
    }
    players.sort((a, b) => a.name.localeCompare(b.name));
    const message: IntercomListMessage = { players };
    client.send(ServerMessage.IntercomList, message);
  }

  private clientOf(sessionId: string): TownClient | undefined {
    return this.clients.find((c) => c.sessionId === sessionId);
  }

  private sendVisitStatus(visit: Pick<PendingVisit, "id" | "visitor" | "owner">, state: VisitState): void {
    const owner = this.sessions.get(visit.owner);
    const message: VisitStatusMessage = {
      requestId: visit.id,
      state,
      ownerName: owner?.name ?? "",
      apartmentId: owner?.apartmentId ?? "",
      ...(state === "accepted" && owner ? { host: owner.uid } : {}),
    };
    this.clientOf(visit.visitor)?.send(ServerMessage.VisitStatus, message);
  }

  /** Ends an open request: the visitor hears `state`, the owner's prompt closes. */
  private closeVisit(visit: PendingVisit, state: VisitState): void {
    visit.timer.clear();
    this.visits.delete(visit.id);
    this.sendVisitStatus(visit, state);
    const closed: VisitClosedMessage = { requestId: visit.id };
    this.clientOf(visit.owner)?.send(ServerMessage.VisitClosed, closed);
  }

  private onVisitRequest(client: TownClient, ownerSessionId: string): void {
    const session = this.sessions.get(client.sessionId);
    if (!session || ownerSessionId === client.sessionId || !this.atIntercom(session)) return;
    const now = Date.now();
    if (now - session.lastVisitRequestMs < VISIT_REQUEST_COOLDOWN_MS) return;
    session.lastVisitRequestMs = now;
    // One open request per visitor: ringing someone else withdraws the last one.
    for (const visit of [...this.visits.values()]) if (visit.visitor === client.sessionId) this.closeVisit(visit, "unavailable");
    const id = randomUUID();
    if (!this.sessions.has(ownerSessionId)) {
      this.sendVisitStatus({ id, visitor: client.sessionId, owner: ownerSessionId }, "unavailable");
      return;
    }
    const visit: PendingVisit = {
      id,
      visitor: client.sessionId,
      owner: ownerSessionId,
      timer: this.clock.setTimeout(() => {
        const open = this.visits.get(id);
        if (open) this.closeVisit(open, "expired");
      }, VISIT_REQUEST_TTL_MS),
    };
    this.visits.set(id, visit);
    const incoming: VisitIncomingMessage = { requestId: id, fromName: session.name, fromApartment: session.apartmentId };
    this.clientOf(ownerSessionId)?.send(ServerMessage.VisitIncoming, incoming);
    this.sendVisitStatus(visit, "pending");
  }

  private onVisitAnswer(client: TownClient, requestId: string, accept: boolean): void {
    const visit = this.visits.get(requestId);
    if (!visit || visit.owner !== client.sessionId) return;
    visit.timer.clear();
    this.visits.delete(requestId);
    const owner = this.sessions.get(visit.owner);
    const visitor = this.sessions.get(visit.visitor);
    const player = this.state.players.get(visit.visitor);
    if (!accept) {
      this.sendVisitStatus(visit, "declined");
      return;
    }
    // The visitor may have wandered into a building (or home) meanwhile.
    if (!owner || !visitor || !player || visitor.tracker.space !== "town") {
      this.sendVisitStatus(visit, "unavailable");
      return;
    }
    this.apartments.grantVisit(owner.uid, visitor.uid);
    visitor.apartmentHost = owner.uid;
    // The server walks the visitor in: they appear inside the host's apartment door.
    const arrival = interiorArrivalPoint("apartment");
    resetMoveTracker(visitor.tracker, arrival, Date.now());
    visitor.epoch++;
    visitor.seq = -1;
    player.space = arrival.space;
    player.x = arrival.pos[0];
    player.z = arrival.pos[1];
    player.heading = arrival.heading;
    player.motion = "idle";
    // Status first, so the client knows whose apartment it is before the teleport lands.
    this.sendVisitStatus(visit, "accepted");
    const teleport: MoveCorrectionMessage = {
      epoch: visitor.epoch,
      space: arrival.space,
      x: arrival.pos[0],
      z: arrival.pos[1],
      heading: arrival.heading,
      reason: "visit",
    };
    this.clientOf(visit.visitor)?.send(ServerMessage.MoveCorrection, teleport);
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

export interface TownRoomDeps {
  verifier: IdTokenVerifier;
  profiles: ProfileStore;
  registry?: TownRegistry;
  apartments?: ApartmentRegistry;
}

export interface TownRoomOptions {
  /** Seats per shard (default TOWN_MAX_CLIENTS; tests use small shards). */
  maxClients?: number;
}

/** A TownRoom class bound to the verifier, the profile store and the registries, for `server.define`. */
export function townRoomWith(deps: TownRoomDeps, options: TownRoomOptions = {}): typeof TownRoom {
  const registry = deps.registry ?? new TownRegistry();
  const apartments = deps.apartments ?? new ApartmentRegistry();
  return class extends TownRoom {
    override maxClients = options.maxClients ?? TOWN_MAX_CLIENTS;
    protected override verifier = deps.verifier;
    protected override profiles = deps.profiles;
    protected override registry = registry;
    protected override apartments = apartments;
  };
}
