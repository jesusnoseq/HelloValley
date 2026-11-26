import { randomUUID } from "node:crypto";
import { type Client, type Delayed, Room, ServerError } from "@colyseus/core";
import {
  activeTargetLang,
  appearanceOf,
  atNoticeBoard,
  NOTICE_BOARD_SLACK_M,
  type QuestEvent,
  type QuestResultMessage,
  type BlockedPlayer,
  CHAT_RATE,
  type ChatBroadcast,
  type ChatPosition,
  type ChatRejectedMessage,
  type ChatRejectReason,
  type ChatReportedMessage,
  type ChatReportInput,
  type ChatReportMessage,
  type ChatSafetyMessage,
  chatAudible,
  ClientMessage,
  type ClientMessagePayloads,
  createMoveTracker,
  createTokenBucket,
  MAX_BLOCKED_PLAYERS,
  REPORT_MAX_MESSAGES,
  type EmoteBroadcast,
  emptyRecipeBook,
  EATING_ACTIVITY_MS,
  type BuffsMessage,
  type CookResultMessage,
  type Emote,
  type FoodEatenMessage,
  judgeSit,
  type RecipeId,
  type SeatStateMessage,
  STAND_UP_MOVE_M,
  type Vec2,
  type IntercomEntry,
  type InventoryStateMessage,
  type IntercomListMessage,
  intercomInteractable,
  interiorArrivalPoint,
  isPrivateSpace,
  isSpaceId,
  JoinOptionsSchema,
  type MoveCorrectionMessage,
  type MoveTracker,
  canTalkTo,
  CAST_MOVE_TOLERANCE_M,
  type FishCastMessage,
  type FishCastResultMessage,
  type FishReelMessage,
  type FishResultMessage,
  type ForageResultMessage,
  type NpcId,
  NPC_TALK_SLACK_M,
  type NpcRefusedMessage,
  parseClientMessage,
  resetMoveTracker,
  ServerMessage,
  SESSION_REPLACED_CODE,
  type SpaceGrids,
  spaceGrid,
  type SpacePoint,
  takeToken,
  type TimeSyncReply,
  type TokenBucket,
  type UserProfile,
  validateMove,
  walkedAway,
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
import { type ChatModerator, moderateChat } from "../moderation/chat";
import { InventoryService } from "../economy/inventory";
import { FishingService } from "../fishing/fishing";
import type { FishingStore } from "../fishing/fishingStore";
import { ForageService } from "../forage/forage";
import type { ForageStore } from "../forage/forageStore";
import { FoodService } from "../food/food";
import type { FoodStore } from "../food/foodStore";
import { QuestService } from "../quests/quests";
import type { QuestStore } from "../quests/questStore";
import { NpcDialogueService } from "../npc/dialogue";
import type { NpcStore } from "../npc/npcStore";
import type { ProfileStore } from "../profiles/profileStore";
import type { SafetyStore } from "../safety/safetyStore";
import { ApartmentRegistry } from "./apartmentRegistry";
import { type RegisteredTown, TownRegistry } from "./townRegistry";
import { TownForageSpawn, TownPlayer, TownState, TownWorld } from "./TownState";

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
/** Chat lines the room remembers, so reports carry the server's own copy of what was said. */
export const CHAT_HISTORY_LINES = 200;
/** Shortest gap between two reports of one player (my number). */
export const REPORT_COOLDOWN_MS = 5000;

/** What `onAuth` returns; Colyseus keeps it on `client.auth`. */
export interface TownAuth {
  uid: string;
  profile: UserProfile;
  /** The player's block list (build plan M18), loaded with the profile. */
  blocks: BlockedPlayer[];
}

export type TownClient = Client<{ auth: TownAuth }>;

/** Rejects every token. Real rooms are created through `townRoomWith(verifier)`. */
const denyAll: IdTokenVerifier = {
  verify: () => Promise.reject(new InvalidIdTokenError()),
};

/** Stores nothing: real rooms get a store through `townRoomWith`. */
const noSafety: SafetyStore = {
  getBlocks: () => Promise.resolve([]),
  saveBlocks: () => Promise.resolve(),
  addReport: () => Promise.reject(new Error("no safety store")),
};

/** Reads nothing: real rooms get the dialogue and inventory services through `townRoomWith`. */
const noNpcStore: NpcStore = {
  load: () => Promise.resolve(null),
  apply: () => Promise.reject(new Error("no NPC store")),
  contact: () => Promise.resolve(null),
  gift: () => Promise.reject(new Error("no NPC store")),
  remember: () => Promise.resolve(null),
  wallet: () => Promise.resolve(null),
  moveSlot: () => Promise.resolve(null),
};
/** Knows no players: real rooms get the fishing service through `townRoomWith`. */
const noFishingStore: FishingStore = {
  context: () => Promise.resolve(null),
  log: () => Promise.resolve({}),
  recordCatch: () => Promise.resolve(null),
};
const noFishing = new FishingService(noFishingStore);
/** Knows no players: real rooms get the forage service through `townRoomWith`. */
const noForageStore: ForageStore = {
  album: () => Promise.resolve({ found: {}, returned: {} }),
  recordFind: () => Promise.resolve(null),
  returnLost: () => Promise.resolve(null),
};
const noForage = new ForageService(noForageStore);
/** Knows no players: real rooms get the food service through `townRoomWith`. */
const noFoodStore: FoodStore = {
  book: () => Promise.resolve(emptyRecipeBook()),
  learn: () => Promise.reject(new Error("no food store")),
  cook: () => Promise.reject(new Error("no food store")),
  eat: () => Promise.reject(new Error("no food store")),
};
const noFood = new FoodService(noFoodStore);
/** Knows no players: real rooms get the quest service through `townRoomWith`. */
const noQuestStore: QuestStore = {
  log: () => Promise.resolve(null),
  level: () => Promise.resolve(null),
  update: () => Promise.reject(new Error("no quest store")),
  settle: () => Promise.resolve(null),
};
const noQuests = new QuestService(noQuestStore);
const noNpcs = new NpcDialogueService(noNpcStore);
const noInventory = new InventoryService(noNpcStore);

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
  /** The language the player's chat lines are in unless they say otherwise (build plan M18). */
  targetLang: string;
  chatBucket: TokenBucket;
  /** uid → name of the players whose chat this session muted (this session only). */
  muted: Map<string, string>;
  /** uid → name of the players this player blocked (stored in `users/{uid}/safety/blocks`). */
  blocked: Map<string, string>;
  /** Block list saves run one after another. */
  blockSave: Promise<void>;
  lastReportMs: number;
  /** The NPC conversation this session is in (build plan M23), for the "chatting" indicator. */
  talkingTo: NpcId | null;
  conversationId: string | null;
  /** Inventory reads and moves run one after another, so `inventory:state` messages arrive in order (build plan M26). */
  inventoryChain: Promise<void>;
  /** Fishing messages run one after another (build plan M27). */
  fishingChain: Promise<void>;
  /** Switches the synced activity from "fishing" to "reeling" at the bite. */
  biteTimer: Delayed | null;
  /** Pick-ups, returns and album reads run one after another (build plan M28). */
  forageChain: Promise<void>;
  /** Bites, dishes and recipe book reads run one after another (build plan M29). */
  foodChain: Promise<void>;
  /** The seat the player sits on, and where their walker stood when they sat down. */
  seat: string | null;
  seatFrom: Vec2 | null;
  /** Ends the synced "eating" activity. */
  eatTimer: Delayed | null;
  /** When the next buff runs out (food clock, ms): the world tick then sends `buffs:state` again. */
  buffExpiry: number | null;
  /** Quest accepts, hand-overs, progress and state reads run one after another (build plan M30). */
  questChain: Promise<void>;
}

/** A delivered chat line, as the room remembers it for reports. */
interface RecentLine extends ChatBroadcast {
  uid: string;
  /** The uids it was delivered to. */
  recipients: Set<string>;
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
  protected safety: SafetyStore = noSafety;
  protected moderateChat: ChatModerator = moderateChat;
  protected npc: NpcDialogueService = noNpcs;
  /** Coins and inventory slots (build plan M26); shares the NPC store so trades and moves see the same records. */
  protected inventory: InventoryService = noInventory;
  /** Casts, catches and the fish encyclopedia (build plan M27). */
  protected fishing: FishingService = noFishing;
  /** Daily forage spawns, pick-ups, lost items and the forage album (build plan M28). */
  protected forage: ForageService = noForage;
  /** Eating, buffs, cooking and the recipe book (build plan M29). */
  protected food: FoodService = noFood;
  /** Daily requests, favours, progress and rewards (build plan M30). */
  protected quests: QuestService = noQuests;
  /** Where joining players appear (tests start next to an NPC). */
  protected spawn: SpacePoint = TOWN_SPAWN;
  private readonly sessions = new Map<string, Session>();
  private readonly recentChat: RecentLine[] = [];
  private readonly visits = new Map<string, PendingVisit>();
  /** Sessions a newer tab replaced: they may not reconnect. */
  private readonly replaced = new Set<string>();
  /** The in-game day the players were last sent their quests for (a new day brings a new board). */
  private questDay: number | null = null;

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
    this.handle(ClientMessage.Chat, (client, chat) => this.onChat(client, chat.text, chat.lang));
    this.handle(ClientMessage.ChatMute, (client, { sessionId, muted }) => this.onChatMute(client, sessionId, muted));
    this.handle(ClientMessage.ChatBlock, (client, { sessionId }) => this.onChatBlock(client, sessionId));
    this.handle(ClientMessage.ChatUnblock, (client, { uid }) => this.onChatUnblock(client, uid));
    this.handle(ClientMessage.ChatReport, (client, report) => this.onChatReport(client, report));
    this.handle(ClientMessage.Interact, (_client, _request) => {
      // NPC conversations start with `npc:start` (build plan M21). World labels need no server (M25),
      // forage is `forage:pick` (M28), shops are conversations (M26), the notice board is `quest:accept` (M30).
    });
    this.handle(ClientMessage.NpcStart, (client, { npcId }) => void this.onNpcStart(client, npcId));
    this.handle(ClientMessage.NpcReply, (client, reply) => void this.onNpcReply(client, reply));
    this.handle(ClientMessage.NpcConfirm, (client, confirm) => void this.onNpcConfirm(client, confirm));
    this.handle(ClientMessage.NpcEnd, (client, { conversationId }) => {
      const session = this.sessions.get(client.sessionId);
      if (!session) return;
      this.npc.end(session.uid, conversationId);
      if (session.conversationId === conversationId) this.stopTalking(client.sessionId, session);
    });
    this.handle(ClientMessage.NpcMemory, (client, memory) => void this.onNpcMemory(client, memory));
    this.handle(ClientMessage.NpcGift, (client, gift) => void this.onNpcGift(client, gift));
    this.handle(ClientMessage.InventoryMove, (client, move) => {
      const session = this.sessions.get(client.sessionId);
      if (session) this.queueInventory(client.sessionId, session, () => this.inventory.move(session.uid, session.targetLang, move));
    });
    this.handle(ClientMessage.FishCast, (client, cast) => this.queueFishing(client.sessionId, () => this.onFishCast(client.sessionId, cast)));
    this.handle(ClientMessage.FishReel, (client, reel) => this.queueFishing(client.sessionId, () => this.onFishReel(client.sessionId, reel)));
    this.handle(ClientMessage.ForagePick, (client, { spawnId }) => this.queueForage(client.sessionId, () => this.onForagePick(client.sessionId, spawnId)));
    this.handle(ClientMessage.NpcReturn, (client, msg) => this.queueForage(client.sessionId, () => this.onNpcReturn(client.sessionId, msg)));
    this.handle(ClientMessage.FoodEat, (client, { slot }) => this.queueFood(client.sessionId, () => this.onFoodEat(client.sessionId, slot)));
    this.handle(ClientMessage.CookMake, (client, { recipeId }) => this.queueFood(client.sessionId, () => this.onCook(client.sessionId, recipeId)));
    this.handle(ClientMessage.QuestAccept, (client, { questId }) => this.queueQuests(client.sessionId, () => this.onQuestAccept(client.sessionId, questId)));
    this.handle(ClientMessage.QuestTurnIn, (client, msg) => this.queueQuests(client.sessionId, () => this.onQuestHandOver(client.sessionId, msg)));
    this.handle(ClientMessage.SeatSit, (client, { seatId }) => this.onSit(client.sessionId, seatId));
    this.handle(ClientMessage.SeatStand, (client) => this.standUp(client.sessionId, true));
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
    let blocks: BlockedPlayer[] = [];
    try {
      blocks = await this.safety.getBlocks(user.uid);
    } catch (err) {
      // Better to play without the block list for a session than not at all.
      console.error(`[town] block list lookup failed for ${user.uid}:`, err);
    }
    return { uid: user.uid, profile, blocks };
  }

  override onJoin(client: TownClient): void {
    const { uid, profile, blocks } = client.auth!;
    const spawn = this.spawn;
    const now = Date.now();
    this.sessions.set(client.sessionId, {
      uid,
      tracker: createMoveTracker(spawn, now),
      seq: -1,
      epoch: 0,
      lastEmoteMs: 0,
      name: profile.name,
      apartmentId: profile.apartmentId,
      apartmentHost: spawn.space === "apartment" ? uid : null,
      lastVisitRequestMs: Number.NEGATIVE_INFINITY,
      targetLang: activeTargetLang(profile),
      chatBucket: createTokenBucket(CHAT_RATE, now),
      muted: new Map(),
      blocked: new Map(blocks.map((b) => [b.uid, b.name])),
      blockSave: Promise.resolve(),
      lastReportMs: Number.NEGATIVE_INFINITY,
      talkingTo: null,
      conversationId: null,
      inventoryChain: Promise.resolve(),
      fishingChain: Promise.resolve(),
      biteTimer: null,
      forageChain: Promise.resolve(),
      foodChain: Promise.resolve(),
      seat: null,
      seatFrom: null,
      eatTimer: null,
      buffExpiry: null,
      questChain: Promise.resolve(),
    });
    this.state.players.set(
      client.sessionId,
      new TownPlayer({
        name: profile.name,
        appearance: JSON.stringify(appearanceOf(profile)),
        space: spawn.space,
        x: spawn.pos[0],
        z: spawn.pos[1],
        heading: spawn.heading,
        motion: "idle",
        talkingTo: "",
        activity: "",
        seat: "",
      }),
    );
    // One session per uid: an older tab (in any shard) is disconnected.
    this.registry.bindSession(uid, this, client.sessionId);
    const welcome: WelcomeMessage = {
      uid,
      shard: this.state.shard,
      spawn: { space: spawn.space, x: spawn.pos[0], z: spawn.pos[1], heading: spawn.heading },
    };
    client.send(ServerMessage.Welcome, welcome);
    this.sendSafety(client.sessionId);
    this.refreshInventory(client.sessionId);
    this.sendFishLog(client.sessionId);
    this.sendForageAlbum(client.sessionId);
    this.sendBuffs(client.sessionId);
    this.sendRecipeBook(client.sessionId);
    this.sendQuests(client.sessionId);
    // Whoever muted this uid sees the new session id in their mute list.
    for (const [sessionId, other] of this.sessions) {
      if (sessionId !== client.sessionId && other.muted.has(uid)) this.sendSafety(sessionId);
    }
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
      // A replaced tab leaves after its successor joined: the conversation is the new tab's now.
      if (!this.replaced.has(client.sessionId)) {
        this.npc.end(session.uid);
        this.inventory.forget(session.uid);
        this.fishing.forget(session.uid);
        this.forage.forget(session.uid);
        this.food.forget(session.uid);
        this.quests.forget(session.uid);
      }
      session.biteTimer?.clear();
      session.eatTimer?.clear();
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
    // Build plan M29: a walk-speed buff (bread) widens the speed check by the same factor the client walks with.
    session.tracker.speedFactor = this.food.speedFactor(session.uid);
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
    // Walking off a seat stands the player up (build plan M29).
    const sat = session.seatFrom;
    if (session.seat && (move.space !== from || !sat || Math.hypot(move.x - sat[0], move.z - sat[1]) > STAND_UP_MOVE_M)) this.standUp(client.sessionId, true);
    // Walking away from the line ends the cast (build plan M27).
    const cast = this.fishing.pending(session.uid);
    if (cast && (move.space !== "town" || Math.hypot(move.x - cast.pos[0], move.z - cast.pos[1]) > CAST_MOVE_TOLERANCE_M)) {
      this.fishing.cancel(session.uid);
      this.stopFishing(client.sessionId, session);
    }
    // Walking away from an NPC (or out of the room) ends the conversation (GDD §8.1 step 4).
    if (session.talkingTo && walkedAway(session.talkingTo, move.space, [move.x, move.z])) {
      this.npc.end(session.uid, session.conversationId ?? undefined);
      this.stopTalking(client.sessionId, session);
    }
  }

  private onEmote(client: TownClient, emote: EmoteBroadcast["emote"]): void {
    const session = this.sessions.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!session || !player) return;
    const now = Date.now();
    // Emotes play only while standing (the shared AnimationStateMachine refuses them otherwise).
    if (now - session.lastEmoteMs < EMOTE_COOLDOWN_MS || player.motion !== "idle") return;
    session.lastEmoteMs = now;
    this.broadcastEmote(client.sessionId, emote);
  }

  /** Relays an emote to the others in the player's space (in an apartment, only that apartment). */
  private broadcastEmote(sessionId: string, emote: Emote): void {
    const session = this.sessions.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!session || !player || !isSpaceId(player.space)) return;
    // In an apartment only the people in that same apartment see it.
    const host = isPrivateSpace(player.space) ? session.apartmentHost : null;
    const message: EmoteBroadcast = { sessionId, emote };
    for (const other of this.clients) {
      if (other.sessionId === sessionId) continue;
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
      if (sessionId === client.sessionId || this.blockedBetween(session, other)) continue;
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
    const owner = this.sessions.get(ownerSessionId);
    // Blocked players cannot ring each other (they look unavailable).
    if (!owner || this.blockedBetween(session, owner)) {
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
    this.standUp(visit.visitor, true);
    if (visitor.talkingTo) {
      this.npc.end(visitor.uid, visitor.conversationId ?? undefined);
      this.stopTalking(visit.visitor, visitor);
    }
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

  // -------------------------------------------------------------------------------------------
  // Proximity chat, mute, block and report (build plan M18, GDD §6.6, architecture §6.4)

  /** Where a session's server-side walker is, for the chat range check. */
  private chatPosition(session: Session): ChatPosition {
    const t = session.tracker;
    return { space: t.space, x: t.pos[0], z: t.pos[1], instance: isPrivateSpace(t.space) ? (session.apartmentHost ?? session.uid) : null };
  }

  private blockedBetween(a: Session, b: Session): boolean {
    return a.blocked.has(b.uid) || b.blocked.has(a.uid);
  }

  private rejectChat(client: TownClient, reason: ChatRejectReason): void {
    const message: ChatRejectedMessage = { reason };
    client.send(ServerMessage.ChatRejected, message);
  }

  /**
   * A chat line: the rate limit, the mandatory server moderation check, then delivery to the
   * sender and to everyone within CHAT_RADIUS_M of the speaker's server-side position (same
   * space, same apartment) who has not muted the sender and is not blocked either way.
   * Translation happens on each reader's client (architecture §5.2): the server never calls a model.
   */
  private onChat(client: TownClient, text: string, claimedLang: string | undefined): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const now = Date.now();
    // TODO(M36): shard-wide mutes for repeat offenders answer "muted" here.
    if (!takeToken(session.chatBucket, CHAT_RATE, now)) return this.rejectChat(client, "rate");
    const lang = claimedLang ?? session.targetLang;
    if (!this.moderateChat(text, { uid: session.uid, lang }).ok) return this.rejectChat(client, "moderation");
    const message: ChatBroadcast = { id: randomUUID(), from: client.sessionId, name: session.name, text, lang, ts: now };
    const speaker = this.chatPosition(session);
    const recipients = new Set<string>();
    for (const other of this.clients) {
      const listener = this.sessions.get(other.sessionId);
      if (!listener) continue;
      if (other !== client) {
        if (!chatAudible(speaker, this.chatPosition(listener))) continue;
        if (listener.muted.has(session.uid) || this.blockedBetween(session, listener)) continue;
      }
      other.send(ServerMessage.ChatMessage, message);
      recipients.add(listener.uid);
    }
    this.recentChat.push({ ...message, uid: session.uid, recipients });
    if (this.recentChat.length > CHAT_HISTORY_LINES) this.recentChat.splice(0, this.recentChat.length - CHAT_HISTORY_LINES);
  }

  /** Sends a session its mute and block lists. */
  private sendSafety(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const muted: string[] = [];
    for (const [id, other] of this.sessions) if (id !== sessionId && session.muted.has(other.uid)) muted.push(id);
    const blocked: BlockedPlayer[] = [...session.blocked].map(([uid, name]) => ({ uid, name }));
    const message: ChatSafetyMessage = { muted, blocked };
    this.clientOf(sessionId)?.send(ServerMessage.ChatSafety, message);
  }

  private onChatMute(client: TownClient, targetSessionId: string, muted: boolean): void {
    const session = this.sessions.get(client.sessionId);
    const target = this.sessions.get(targetSessionId);
    if (!session || !target || target.uid === session.uid) return;
    if (muted) session.muted.set(target.uid, target.name);
    else session.muted.delete(target.uid);
    this.sendSafety(client.sessionId);
  }

  /** Saves the block list after the saves already queued. */
  private saveBlocks(session: Session): void {
    session.blockSave = session.blockSave
      .then(() => this.safety.saveBlocks(session.uid, [...session.blocked].map(([uid, name]) => ({ uid, name }))))
      .catch((err: unknown) => console.error(`[town] block list save failed for ${session.uid}:`, err));
  }

  private onChatBlock(client: TownClient, targetSessionId: string): void {
    const session = this.sessions.get(client.sessionId);
    const target = this.sessions.get(targetSessionId);
    if (!session || !target || target.uid === session.uid || session.blocked.has(target.uid)) return;
    if (session.blocked.size >= MAX_BLOCKED_PLAYERS) return;
    session.blocked.set(target.uid, target.name);
    // Open visit requests between the two end.
    for (const visit of [...this.visits.values()]) {
      const pair = [visit.visitor, visit.owner];
      if (pair.includes(client.sessionId) && pair.includes(targetSessionId)) this.closeVisit(visit, "unavailable");
    }
    this.saveBlocks(session);
    this.sendSafety(client.sessionId);
  }

  private onChatUnblock(client: TownClient, uid: string): void {
    const session = this.sessions.get(client.sessionId);
    if (!session?.blocked.delete(uid)) return;
    this.saveBlocks(session);
    this.sendSafety(client.sessionId);
  }

  /**
   * A report goes to `reports/{id}` with the server's own copies of the reported player's last
   * lines that reached the reporter, so a client cannot put words in anyone's mouth. Reporting
   * also mutes the reported player for the reporter.
   * TODO(M36): reports feed strikes and shard-wide mutes; a moderator review tool.
   */
  private onChatReport(client: TownClient, report: ChatReportMessage): void {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const answer = (ok: boolean) => {
      const message: ChatReportedMessage = { ok };
      this.clientOf(client.sessionId)?.send(ServerMessage.ChatReported, message);
    };
    const now = Date.now();
    if (now - session.lastReportMs < REPORT_COOLDOWN_MS) return answer(false);
    const line = report.messageId ? this.recentChat.find((l) => l.id === report.messageId) : undefined;
    // A named line must be the reported player's, and one the reporter actually received.
    if (report.messageId && (!line || line.from !== report.sessionId || !line.recipients.has(session.uid))) return answer(false);
    const target = this.sessions.get(report.sessionId);
    const reportedUid = target?.uid ?? line?.uid;
    const reportedName = target?.name ?? line?.name;
    if (!reportedUid || !reportedName || reportedUid === session.uid) return answer(false);
    session.lastReportMs = now;

    const heard = this.recentChat.filter((l) => l.uid === reportedUid && l.recipients.has(session.uid));
    let picked = heard.slice(-REPORT_MAX_MESSAGES);
    if (line && !picked.includes(line)) {
      picked = [...heard.filter((l) => l !== line).slice(-(REPORT_MAX_MESSAGES - 1)), line].sort((a, b) => a.ts - b.ts);
    }
    const doc: ChatReportInput = {
      kind: "chat",
      reporterUid: session.uid,
      reportedUid,
      reportedName,
      reason: report.reason,
      ...(line ? { messageId: line.id } : {}),
      shard: this.state.shard,
      messages: picked.map((l) => ({ id: l.id, text: l.text, lang: l.lang, ts: l.ts })),
    };
    session.muted.set(reportedUid, reportedName);
    this.sendSafety(client.sessionId);
    this.safety.addReport(doc).then(
      () => answer(true),
      (err: unknown) => {
        console.error(`[town] report by ${session.uid} could not be saved:`, err);
        answer(false);
      },
    );
  }

  // -------------------------------------------------------------------------------------------
  // NPC conversations (build plan M21, architecture §5.3, §6.1). The client calls the model; the
  // room only hands out context and turn ids and validates what comes back.

  private refuseNpc(sessionId: string, message: NpcRefusedMessage): void {
    this.clientOf(sessionId)?.send(ServerMessage.NpcRefused, message);
  }

  /** The "chatting" indicator goes off. */
  private stopTalking(sessionId: string, session: Session): void {
    session.talkingTo = null;
    session.conversationId = null;
    const player = this.state.players.get(sessionId);
    if (player) player.talkingTo = "";
  }

  /**
   * `npc:start`: only next to the NPC (the server's own walker, against the shared NPC posts;
   * TODO(M31): live NPC positions). A new conversation replaces the previous one.
   */
  private async onNpcStart(client: TownClient, npcId: NpcId): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const t = session.tracker;
    if (!canTalkTo(npcId, t.space, t.pos, NPC_TALK_SLACK_M)) return this.refuseNpc(client.sessionId, { reason: "too_far", npcId });
    const result = await this.npc.start({
      uid: session.uid,
      npcId,
      lang: session.targetLang,
      nativeLang: client.auth!.profile.nativeLang,
      // Build plan M28: the Gossip knows where today's lost items lie in this shard.
      ...(npcId === "gossip" ? { lostHints: this.forage.hints(this.state.shard) } : {}),
    });
    if (!result.ok) return this.refuseNpc(client.sessionId, { reason: result.reason, npcId });
    // The session may have left while the store answered.
    const player = this.state.players.get(client.sessionId);
    if (!player || this.sessions.get(client.sessionId) !== session) return;
    session.talkingTo = npcId;
    session.conversationId = result.context.conversationId;
    player.talkingTo = npcId;
    this.clientOf(client.sessionId)?.send(ServerMessage.NpcContext, result.context);
  }

  private async onNpcReply(client: TownClient, reply: ClientMessagePayloads[typeof ClientMessage.NpcReply]): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const result = await this.npc.reply(session.uid, reply);
    if (!result.ok) return this.refuseNpc(client.sessionId, { reason: result.reason, conversationId: reply.conversationId, turnId: reply.turnId });
    this.clientOf(client.sessionId)?.send(ServerMessage.NpcApplied, result.applied);
    // An NPC's gift landed in the inventory.
    if (result.applied.accepted.some((a) => a.type === "give")) this.refreshInventory(client.sessionId);
    // Build plan M29: a taught recipe is in the book now.
    if (result.applied.accepted.some((a) => a.type === "teachRecipe")) this.sendRecipeBook(client.sessionId);
    // Build plan M30: a request given (giveQuest) or completed (completeQuest) in this turn.
    if (result.quests.length > 0) this.questResults(client.sessionId, result.quests);
  }

  private async onNpcConfirm(client: TownClient, confirm: ClientMessagePayloads[typeof ClientMessage.NpcConfirm]): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const result = await this.npc.confirm(session.uid, confirm);
    if ("reason" in result && !("tradeId" in result)) return this.refuseNpc(client.sessionId, { reason: result.reason, conversationId: confirm.conversationId });
    this.clientOf(client.sessionId)?.send(ServerMessage.NpcTrade, result);
    if ("ok" in result && result.ok) this.refreshInventory(client.sessionId);
  }

  /** `npc:memory` (build plan M24): the compaction of a conversation that ended; the server stores it and adapts the level. */
  private async onNpcMemory(client: TownClient, memory: ClientMessagePayloads[typeof ClientMessage.NpcMemory]): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const result = await this.npc.remember(session.uid, memory);
    if (!result.ok) return this.refuseNpc(client.sessionId, { reason: result.reason, conversationId: memory.conversationId });
    this.clientOf(client.sessionId)?.send(ServerMessage.NpcRemembered, result.remembered);
  }

  /** `npc:gift` (build plan M24): one item from the inventory to the NPC the player is talking to. */
  private async onNpcGift(client: TownClient, gift: ClientMessagePayloads[typeof ClientMessage.NpcGift]): Promise<void> {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const result = await this.npc.gift(session.uid, gift);
    if (!result.ok) return this.refuseNpc(client.sessionId, { reason: result.reason, conversationId: gift.conversationId });
    this.clientOf(client.sessionId)?.send(ServerMessage.NpcGifted, result.gifted);
    if (result.gifted.ok) this.refreshInventory(client.sessionId);
  }

  // -------------------------------------------------------------------------------------------
  // Inventory (build plan M26, GDD §5.6): the server's records, pushed to the player.

  /** Runs an inventory read or move after the ones already queued for this session and sends the answer. */
  private queueInventory(sessionId: string, session: Session, task: () => Promise<InventoryStateMessage | null>): void {
    session.inventoryChain = session.inventoryChain
      .then(task)
      .then((state) => {
        if (state && this.sessions.get(sessionId) === session) this.clientOf(sessionId)?.send(ServerMessage.InventoryState, state);
      })
      .catch((err: unknown) => console.error(`[town] inventory update for ${session.uid} failed:`, err));
  }

  /** Sends the player's current coins and slots. */
  private refreshInventory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) this.queueInventory(sessionId, session, () => this.inventory.state(session.uid, session.targetLang));
  }

  // -------------------------------------------------------------------------------------------
  // Fishing (build plan M27, GDD §5.2): the server checks the spot and the rod, rolls the fish and
  // judges the reported catch; the bite and the mini-game run on the client.

  private queueFishing(sessionId: string, task: () => Promise<void>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.fishingChain = session.fishingChain.then(task).catch((err: unknown) => console.error(`[town] fishing for ${session.uid} failed:`, err));
  }

  /** The synced activity goes back to nothing. */
  private stopFishing(sessionId: string, session: Session): void {
    session.biteTimer?.clear();
    session.biteTimer = null;
    const player = this.state.players.get(sessionId);
    if (player) player.activity = "";
  }

  private async onFishCast(sessionId: string, msg: FishCastMessage): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const t = session.tracker;
    const where = { space: t.space, pos: [t.pos[0], t.pos[1]] as [number, number], talking: session.talkingTo !== null };
    const result: FishCastResultMessage = await this.fishing.cast(session.uid, session.targetLang, msg, where);
    if (this.sessions.get(sessionId) !== session) return;
    const player = this.state.players.get(sessionId);
    if (result.ok && player) {
      player.activity = "fishing";
      player.heading = wrapAngle(msg.heading);
      session.biteTimer?.clear();
      const castId = result.castId;
      session.biteTimer = this.clock.setTimeout(() => {
        session.biteTimer = null;
        if (this.fishing.pending(session.uid)?.castId === castId) player.activity = "reeling";
      }, result.biteInMs);
    }
    this.clientOf(sessionId)?.send(ServerMessage.FishCast, result);
  }

  private async onFishReel(sessionId: string, msg: FishReelMessage): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const t = session.tracker;
    const result: FishResultMessage = await this.fishing.reel(session.uid, session.targetLang, msg, { space: t.space, pos: [t.pos[0], t.pos[1]] });
    if (this.sessions.get(sessionId) !== session) return;
    if (!this.fishing.pending(session.uid)) this.stopFishing(sessionId, session);
    this.clientOf(sessionId)?.send(ServerMessage.FishResult, result);
    if (result.outcome === "caught") {
      if (result.kept) this.refreshInventory(sessionId);
      this.sendFishLog(sessionId);
      // Build plan M30: the server's catch counts for catch requests.
      this.questEvent(sessionId, { type: "caught", fishId: result.fishId });
    }
  }

  /** Sends the player's fish encyclopedia. */
  private sendFishLog(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.queueFishing(sessionId, async () => {
      const log = await this.fishing.log(session.uid);
      if (log && this.sessions.get(sessionId) === session) this.clientOf(sessionId)?.send(ServerMessage.FishLog, log);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Foraging and lost items (build plan M28, GDD §5.3): the day's spawns are shared state; the
  // server checks every pick-up against its own walker and hands lost items back to their owners.

  private queueForage(sessionId: string, task: () => Promise<void>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.forageChain = session.forageChain.then(task).catch((err: unknown) => console.error(`[town] foraging for ${session.uid} failed:`, err));
  }

  /** Mirrors the shard's open spawns into the state (a new in-game day replaces the whole set). */
  private syncForage(): void {
    const { spawns } = this.forage.open(this.state.shard);
    const open = new Set(spawns.map((s) => s.spawnId));
    const map = this.state.forage;
    for (const id of [...map.keys()]) if (!open.has(id)) map.delete(id);
    for (const s of spawns) {
      if (!map.has(s.spawnId)) map.set(s.spawnId, new TownForageSpawn({ itemId: s.itemId, kind: s.kind, x: s.pos[0], z: s.pos[1] }));
    }
  }

  private async onForagePick(sessionId: string, spawnId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const t = session.tracker;
    const busy = session.talkingTo !== null || this.fishing.pending(session.uid) !== undefined;
    const where = { space: t.space, pos: [t.pos[0], t.pos[1]] as [number, number], talking: busy };
    const result: ForageResultMessage = await this.forage.pick(session.uid, session.targetLang, this.state.shard, spawnId, where);
    this.syncForage();
    if (this.sessions.get(sessionId) !== session) return;
    this.clientOf(sessionId)?.send(ServerMessage.ForageResult, result);
    if (result.ok) {
      this.refreshInventory(sessionId);
      await this.sendAlbumNow(sessionId, session);
      // Build plan M30: the server's pick-up counts for find requests.
      this.questEvent(sessionId, { type: "found", itemId: result.itemId });
    }
  }

  /** `npc:return`: in a conversation with the owner, a lost item goes back for hearts (shared rules). */
  private async onNpcReturn(sessionId: string, msg: ClientMessagePayloads[typeof ClientMessage.NpcReturn]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const c = this.npc.conversationFor(session.uid, msg.conversationId);
    if (!c.ok) return this.refuseNpc(sessionId, { reason: c.reason, conversationId: msg.conversationId });
    const result = await this.forage.returnLost(session.uid, c.lang, msg.conversationId, c.npcId, msg.itemId);
    if (this.sessions.get(sessionId) !== session) return;
    if (!result.ok) return this.refuseNpc(sessionId, { reason: result.reason, conversationId: msg.conversationId });
    this.clientOf(sessionId)?.send(ServerMessage.NpcReturned, result.returned);
    if (result.returned.ok) {
      this.refreshInventory(sessionId);
      await this.sendAlbumNow(sessionId, session);
    }
  }

  private async sendAlbumNow(sessionId: string, session: Session): Promise<void> {
    const album = await this.forage.album(session.uid);
    if (album && this.sessions.get(sessionId) === session) this.clientOf(sessionId)?.send(ServerMessage.ForageAlbum, album);
  }

  /** Sends the player's forage album. */
  private sendForageAlbum(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) this.queueForage(sessionId, () => this.sendAlbumNow(sessionId, session));
  }

  // -------------------------------------------------------------------------------------------
  // Eating, sitting and cooking (build plan M29, GDD §5.4): the server takes the bite, keeps the
  // buffs, checks the seat and the kitchen against its own walker, and cooks in one transaction.

  private queueFood(sessionId: string, task: () => Promise<void>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.foodChain = session.foodChain.then(task).catch((err: unknown) => console.error(`[town] food for ${session.uid} failed:`, err));
  }

  private async onFoodEat(sessionId: string, slot: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const busy = this.fishing.pending(session.uid) !== undefined;
    const result = await this.food.eat(session.uid, session.targetLang, slot, busy);
    if (this.sessions.get(sessionId) !== session) return;
    const message: FoodEatenMessage = result.message;
    this.clientOf(sessionId)?.send(ServerMessage.FoodEaten, message);
    if (!message.ok) return;
    this.refreshInventory(sessionId);
    this.sendBuffs(sessionId);
    // Everyone around sees the bite (the eat clip), and the cake's cheer.
    const player = this.state.players.get(sessionId);
    if (player && player.activity === "") {
      player.activity = "eating";
      session.eatTimer?.clear();
      session.eatTimer = this.clock.setTimeout(() => {
        session.eatTimer = null;
        if (player.activity === "eating") player.activity = "";
      }, EATING_ACTIVITY_MS);
    }
    if (result.emote) this.broadcastEmote(sessionId, result.emote);
  }

  private async onCook(sessionId: string, recipeId: RecipeId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const t = session.tracker;
    const busy = this.fishing.pending(session.uid) !== undefined;
    const result: CookResultMessage = await this.food.cook(session.uid, session.targetLang, recipeId, { space: t.space, pos: [t.pos[0], t.pos[1]], busy });
    if (this.sessions.get(sessionId) !== session) return;
    this.clientOf(sessionId)?.send(ServerMessage.CookResult, result);
    if (result.ok) {
      this.refreshInventory(sessionId);
      await this.sendBookNow(sessionId, session);
      // Build plan M30: the server's dish counts for cook requests.
      this.questEvent(sessionId, { type: "cooked", recipeId: result.recipeId });
    }
  }

  /** `seat:sit`: on a free seat in reach of the server's walker. */
  private onSit(sessionId: string, seatId: string): void {
    const session = this.sessions.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!session || !player) return;
    const t = session.tracker;
    const taken = [...this.sessions.entries()].some(([id, other]) => id !== sessionId && other.seat === seatId);
    const busy = this.fishing.pending(session.uid) !== undefined;
    const verdict = judgeSit(seatId, t.space, t.pos, taken, busy);
    if (!verdict.ok) {
      const refused: SeatStateMessage = { seatId: session.seat, refused: verdict.reason };
      this.clientOf(sessionId)?.send(ServerMessage.SeatState, refused);
      return;
    }
    session.seat = verdict.seat.id;
    session.seatFrom = [t.pos[0], t.pos[1]];
    player.seat = verdict.seat.id;
    player.heading = verdict.seat.facing;
    player.motion = "idle";
    const message: SeatStateMessage = { seatId: verdict.seat.id };
    this.clientOf(sessionId)?.send(ServerMessage.SeatState, message);
  }

  /** The player stands up (`seat:stand`, walking off, a teleport). */
  private standUp(sessionId: string, tell: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session?.seat) return;
    session.seat = null;
    session.seatFrom = null;
    const player = this.state.players.get(sessionId);
    if (player) player.seat = "";
    if (tell) {
      const message: SeatStateMessage = { seatId: null };
      this.clientOf(sessionId)?.send(ServerMessage.SeatState, message);
    }
  }

  /** Sends the running buffs; the world tick sends them again when the next one runs out. */
  private sendBuffs(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const message: BuffsMessage = { buffs: this.food.wireBuffs(session.uid) };
    this.clientOf(sessionId)?.send(ServerMessage.Buffs, message);
    session.buffExpiry = this.food.nextExpiry(session.uid);
  }

  private async sendBookNow(sessionId: string, session: Session): Promise<void> {
    const book = await this.food.book(session.uid);
    if (book && this.sessions.get(sessionId) === session) this.clientOf(sessionId)?.send(ServerMessage.RecipeBook, book);
  }

  /** Sends the player's recipe book. */
  private sendRecipeBook(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) this.queueFood(sessionId, () => this.sendBookNow(sessionId, session));
  }

  // -------------------------------------------------------------------------------------------
  // Daily requests and quests (build plan M30, GDD §5.5): the board is taken at the notice board
  // (the server's walker), hand-overs in a conversation, progress from the server's own events.

  private queueQuests(sessionId: string, task: () => Promise<void>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.questChain = session.questChain.then(task).catch((err: unknown) => console.error(`[town] quests for ${session.uid} failed:`, err));
  }

  private async sendQuestsNow(sessionId: string, session: Session): Promise<void> {
    const state = await this.quests.state(session.uid, session.targetLang);
    if (state && this.sessions.get(sessionId) === session) this.clientOf(sessionId)?.send(ServerMessage.QuestState, state);
  }

  /** Sends the player today's board and their quest log. */
  private sendQuests(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) this.queueQuests(sessionId, () => this.sendQuestsNow(sessionId, session));
  }

  /** Tells the player what happened to their requests; a completion moved coins and items, and the log changed. */
  private questResults(sessionId: string, results: readonly QuestResultMessage[]): void {
    for (const r of results) this.clientOf(sessionId)?.send(ServerMessage.QuestResult, r);
    if (results.some((r) => r.ok && r.action === "complete")) this.refreshInventory(sessionId);
    if (results.some((r) => r.ok)) this.sendQuests(sessionId);
  }

  /** A server event moves the player's open requests (and completes the ones that are done). */
  private questEvent(sessionId: string, event: QuestEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.queueQuests(sessionId, async () => {
      const { moved, completed } = await this.quests.onEvent(session.uid, session.targetLang, event);
      if (this.sessions.get(sessionId) !== session) return;
      for (const r of completed) this.clientOf(sessionId)?.send(ServerMessage.QuestResult, r);
      if (completed.some((r) => r.ok)) this.refreshInventory(sessionId);
      if (moved) await this.sendQuestsNow(sessionId, session);
    });
  }

  /** `quest:accept`: only at the Town Hall notice board (the server's own walker). */
  private async onQuestAccept(sessionId: string, questId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const t = session.tracker;
    const result: QuestResultMessage = atNoticeBoard(t.space, t.pos, NOTICE_BOARD_SLACK_M)
      ? await this.quests.accept(session.uid, session.targetLang, questId, null)
      : { questId, action: "accept", ok: false, reason: "too_far" };
    if (this.sessions.get(sessionId) !== session) return;
    this.clientOf(sessionId)?.send(ServerMessage.QuestResult, result);
    if (result.ok) await this.sendQuestsNow(sessionId, session);
  }

  /** `quest:handover`: in a conversation, a delivery or fetch goes to the NPC (the quest service checks who, what and when). */
  private async onQuestHandOver(sessionId: string, msg: ClientMessagePayloads[typeof ClientMessage.QuestTurnIn]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const c = this.npc.conversationFor(session.uid, msg.conversationId);
    const result: QuestResultMessage = c.ok
      ? await this.quests.complete(session.uid, c.lang, msg.questId, c.npcId, "hand_over")
      : { questId: msg.questId, action: "complete", ok: false, reason: c.reason === "rate" ? "rate" : "no_conversation" };
    if (this.sessions.get(sessionId) !== session) return;
    this.clientOf(sessionId)?.send(ServerMessage.QuestResult, result);
    if (result.ok) {
      this.refreshInventory(sessionId);
      await this.sendQuestsNow(sessionId, session);
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
    // Build plan M28: a new in-game day (on the forage service's clock) brings fresh spawns.
    this.syncForage();
    // Build plan M29: a buff that ran out leaves the player's HUD.
    const foodNow = this.food.now();
    for (const [sessionId, session] of this.sessions) if (session.buffExpiry !== null && foodNow >= session.buffExpiry) this.sendBuffs(sessionId);
    // Build plan M30: a new in-game day (on the quest service's clock) brings a new board.
    const questDay = this.quests.clock().day;
    if (this.questDay !== null && questDay !== this.questDay) for (const sessionId of this.sessions.keys()) this.sendQuests(sessionId);
    this.questDay = questDay;
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
  /** Block lists and reports (build plan M18). */
  safety: SafetyStore;
  /** The mandatory server chat check (default: `moderateChat`). */
  moderateChat?: ChatModerator;
  registry?: TownRegistry;
  apartments?: ApartmentRegistry;
  /** NPC conversations (build plan M21); shared by every shard so the per-day limits hold. */
  npc?: NpcDialogueService;
  /** Coins and inventory slots (build plan M26), over the same store as `npc`. */
  inventory?: InventoryService;
  /** Casts, catches and the encyclopedia (build plan M27); shared by every shard so the pacing holds across them. */
  fishing?: FishingService;
  /** Daily spawns per shard, pick-ups, returns and the forage album (build plan M28); shared by every shard. */
  forage?: ForageService;
  /** Eating, buffs, cooking and the recipe book (build plan M29); shared by every shard so buffs follow the player. */
  food?: FoodService;
  /** Daily requests and quests (build plan M30); shared by every shard. */
  quests?: QuestService;
}

export interface TownRoomOptions {
  /** Seats per shard (default TOWN_MAX_CLIENTS; tests use small shards). */
  maxClients?: number;
  /** Where joining players appear (default TOWN_SPAWN; tests start next to an NPC). */
  spawn?: SpacePoint;
}

/** A TownRoom class bound to the verifier, the profile store and the registries, for `server.define`. */
export function townRoomWith(deps: TownRoomDeps, options: TownRoomOptions = {}): typeof TownRoom {
  const registry = deps.registry ?? new TownRegistry();
  const apartments = deps.apartments ?? new ApartmentRegistry();
  const npc = deps.npc ?? noNpcs;
  const inventory = deps.inventory ?? noInventory;
  const fishing = deps.fishing ?? noFishing;
  const forage = deps.forage ?? noForage;
  const food = deps.food ?? noFood;
  const quests = deps.quests ?? noQuests;
  return class extends TownRoom {
    override maxClients = options.maxClients ?? TOWN_MAX_CLIENTS;
    protected override verifier = deps.verifier;
    protected override profiles = deps.profiles;
    protected override registry = registry;
    protected override apartments = apartments;
    protected override safety = deps.safety;
    protected override moderateChat = deps.moderateChat ?? moderateChat;
    protected override npc = npc;
    protected override inventory = inventory;
    protected override fishing = fishing;
    protected override forage = forage;
    protected override food = food;
    protected override quests = quests;
    protected override spawn = options.spawn ?? TOWN_SPAWN;
  };
}
