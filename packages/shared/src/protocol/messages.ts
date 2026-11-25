// Type-only imports: this module stays free of zod so the client's entry chunk can use it.
import type { FurnitureEdit, FurnitureEditRejection } from "../apartment/layout";
import type { Emote } from "../avatar/animation";
import type { Weather } from "../data/world";
import type { Motion, SpaceId } from "../world/player";

/** Colyseus room names registered by the server (architecture §7.1). */
export const RoomName = {
  Town: "town",
  /** One private ApartmentRoom per owner (filtered by the `owner` join option, build plan M17). */
  Apartment: "apartment",
} as const;
export type RoomName = (typeof RoomName)[keyof typeof RoomName];

/** Messages the client sends to a room. Payload schemas are in `schemas.ts`. */
export const ClientMessage = {
  /**
   * Where the client's predicted walker is (build plan M16): the server validates the report
   * (speed cap, walkability, doors) and corrects the client when it rejects one.
   */
  PlayerMove: "player:move",
  /** Play an emote (keys 1–5). */
  Emote: "player:emote",
  /** Clock sync probe: the server answers with its wall time. */
  TimeSync: "time:sync",
  /** A proximity chat line typed by the player (build plan M18). */
  Chat: "chat:send",
  /** Mute or unmute a player's chat for this session (server-enforced). */
  ChatMute: "chat:mute",
  /** Block a player: no chat either way and no visit requests, kept across sessions. */
  ChatBlock: "chat:block",
  /** Lift a block, by uid (the blocked player may be offline). */
  ChatUnblock: "chat:unblock",
  /** Report a player (and optionally one of their lines) to moderators. Also mutes them. */
  ChatReport: "chat:report",
  /** Talk to an NPC or use a world object (F / click). */
  Interact: "interact:request",
  /** TownRoom, at the lobby intercom: list the players online (build plan M17). */
  IntercomList: "intercom:list",
  /** TownRoom, at the lobby intercom: ring a player's apartment to ask for a visit. */
  VisitRequest: "visit:request",
  /** TownRoom, from the owner: accept or decline a visit request. */
  VisitAnswer: "visit:answer",
  /** ApartmentRoom, owner only: one placement-mode edit (move, rotate, store, place). */
  FurnitureEdit: "furniture:edit",
  // TODO(M21): "npc:reply" (the untrusted NPC turn proposal, architecture §5.3).
} as const;
export type ClientMessage = (typeof ClientMessage)[keyof typeof ClientMessage];

/** Messages the server sends to clients. */
export const ServerMessage = {
  /** Sent once after a join: the verified uid, the shard and where the server placed the player. */
  Welcome: "session:welcome",
  /** A position report was rejected: the client snaps back to this point. */
  MoveCorrection: "move:correct",
  /** Another player in the same space played an emote. */
  Emote: "player:emote",
  /** Answer to `ClientMessage.TimeSync`. */
  TimeSync: "time:sync",
  /** Answer to `ClientMessage.IntercomList`. */
  IntercomList: "intercom:list",
  /** To an owner: someone at the intercom asks to visit. */
  VisitIncoming: "visit:incoming",
  /** To an owner: a request they were shown is no longer open (expired, withdrawn, visitor left). */
  VisitClosed: "visit:closed",
  /** To a visitor: what happened to their request. */
  VisitStatus: "visit:status",
  /** ApartmentRoom: the answer to one `furniture:edit`. */
  FurnitureResult: "furniture:result",
  /** A chat line that passed the server checks, to everyone in range (and back to its sender). */
  ChatMessage: "chat:message",
  /** To a sender: their line was not delivered. */
  ChatRejected: "chat:rejected",
  /** The player's own mute and block lists (on join and after every change). */
  ChatSafety: "chat:safety",
  /** The answer to a `chat:report`. */
  ChatReported: "chat:reported",
} as const;
export type ServerMessage = (typeof ServerMessage)[keyof typeof ServerMessage];

/** Close code when a newer session of the same uid (another tab) replaced this one. Do not rejoin. */
export const SESSION_REPLACED_CODE = 4801;

/** ApartmentRoom close code for a visitor whose visit ended (they left through the door). */
export const VISIT_ENDED_CODE = 4802;

/** A point in one space, as sent on the wire. */
export interface WireSpacePoint {
  space: SpaceId;
  x: number;
  z: number;
  heading: number;
}

/** Payload of `ServerMessage.Welcome`. */
export interface WelcomeMessage {
  uid: string;
  /** Shard number ("Valley #1"). */
  shard: number;
  /** Where the server placed the player; the client starts its walker there. */
  spawn: WireSpacePoint;
}

/** Payload of `ClientMessage.PlayerMove`. */
export interface PlayerMoveMessage extends WireSpacePoint {
  /** Increases with every report. Reports with a seq at or below the last one are ignored. */
  seq: number;
  /** The last correction epoch the client applied. Reports from an older epoch are ignored. */
  epoch: number;
  motion: Motion;
}

/**
 * Why the server moved the walker: a rejected report (`speed`, `blocked`, `space`) or a server
 * teleport (`visit`: an accepted visit puts the visitor inside the host's apartment).
 */
export type MoveRejectReason = "speed" | "blocked" | "space" | "visit";

/** Payload of `ServerMessage.MoveCorrection`. */
export interface MoveCorrectionMessage extends WireSpacePoint {
  epoch: number;
  reason: MoveRejectReason;
}

/** Payload of `ClientMessage.Emote`. */
export interface EmoteRequest {
  emote: Emote;
}

/** Payload of `ServerMessage.Emote`. */
export interface EmoteBroadcast {
  sessionId: string;
  emote: Emote;
}

/** Payload of `ClientMessage.TimeSync`: the client's clock when it sent the probe. */
export interface TimeSyncRequest {
  t: number;
}

/** Payload of `ServerMessage.TimeSync`: the probe's `t` plus the server's wall clock. */
export interface TimeSyncReply {
  t: number;
  server: number;
}

/**
 * Fields of one player in the synced TownRoom state (the server's `TownPlayer` schema matches
 * this). The appearance is the profile's `{animal, colors}` as JSON (AvatarAppearanceSchema).
 */
export interface TownPlayerView {
  name: string;
  appearance: string;
  space: SpaceId;
  x: number;
  z: number;
  heading: number;
  motion: Motion;
}

/** The synced world clock and weather (the server's `TownWorld` schema). */
export interface TownWorldView {
  /** Server wall time (ms) at the last clock tick (once a second). */
  serverTime: number;
  /** In-game day index (world/clock.ts). */
  day: number;
  weather: Weather;
  previousWeather: Weather;
  /** Server wall time (ms) when the current weather slot began. */
  weatherSince: number;
}

/** One player the lobby intercom lists (build plan M17). */
export interface IntercomEntry {
  /** TownRoom session id: what `visit:request` names. */
  sessionId: string;
  name: string;
  apartmentId: string;
  /** In their apartment right now. */
  home: boolean;
}

/** Payload of `ServerMessage.IntercomList`. */
export interface IntercomListMessage {
  players: IntercomEntry[];
}

/** Payload of `ClientMessage.VisitRequest`. */
export interface VisitRequestMessage {
  sessionId: string;
}

/** Payload of `ServerMessage.VisitIncoming`. */
export interface VisitIncomingMessage {
  requestId: string;
  fromName: string;
  fromApartment: string;
}

/** Payload of `ServerMessage.VisitClosed`. */
export interface VisitClosedMessage {
  requestId: string;
}

/** Payload of `ClientMessage.VisitAnswer`. */
export interface VisitAnswerMessage {
  requestId: string;
  accept: boolean;
}

/**
 * Where a visit request stands: `pending` (ringing), `accepted`, `declined`, `expired` (no
 * answer in time), `unavailable` (the owner left, or the visitor is no longer at the intercom).
 */
export type VisitState = "pending" | "accepted" | "declined" | "expired" | "unavailable";

/** Payload of `ServerMessage.VisitStatus`. */
export interface VisitStatusMessage {
  requestId: string;
  state: VisitState;
  ownerName: string;
  apartmentId: string;
  /** With `accepted`: the owner's uid, to join their ApartmentRoom (`owner` join option). */
  host?: string;
}

/** Payload of `ClientMessage.FurnitureEdit`. */
export type FurnitureEditMessage = FurnitureEdit & {
  /** Client counter echoed in the result. */
  editId: number;
};

/** Payload of `ServerMessage.FurnitureResult`. */
export interface FurnitureResultMessage {
  editId: number;
  ok: boolean;
  reason?: FurnitureEditRejection | "not_owner";
  /** With `invalid`: what the placement rules objected to. */
  problems?: string[];
}

/** One person in an apartment (the ApartmentRoom's synced `occupants`, keyed by its session id). */
export interface ApartmentOccupantView {
  name: string;
  /** Their TownRoom session id: their avatar's position is in the TownRoom state. */
  townSession: string;
  owner: boolean;
}

/**
 * The synced ApartmentRoom state (the server's `ApartmentState`). The layout is JSON of the
 * shared `ApartmentLayoutData`; `revision` counts accepted edits.
 */
export interface ApartmentStateView {
  owner: string;
  ownerName: string;
  apartmentId: string;
  layout: string;
  revision: number;
}

/** Longest chat line a player can send, in characters (after trimming). */
export const CHAT_MAX_LENGTH = 200;

/** Payload of `ClientMessage.Chat`. */
export interface ChatSendMessage {
  text: string;
  /**
   * The language the line is written in, as the sender's client says (an untrusted claim; it only
   * decides how readers translate it). Missing: the sender's target language.
   * The sender picks it with the chat input's language toggle (M18). Build plan M20 adds on-device
   * detection (`detectLanguage`), used for the NPC native-language redirect (TODO(M23)), not here.
   */
  lang?: string;
}

/** Payload of `ServerMessage.ChatMessage` (build plan M18, GDD §6.6). */
export interface ChatBroadcast {
  /** Server-issued id: translations are cached per message id, reports name it. */
  id: string;
  /** The sender's TownRoom session id. */
  from: string;
  name: string;
  /** The text as written (it passed the server's moderation check). */
  text: string;
  /** The language it is written in. */
  lang: string;
  /** Server wall time (ms). */
  ts: number;
}

/**
 * Why a line was not delivered: `moderation` (the server check refused it), `rate` (too many lines
 * too fast), `muted` (the sender is muted shard-wide, TODO(M36)).
 */
export type ChatRejectReason = "moderation" | "rate" | "muted";

/** Payload of `ServerMessage.ChatRejected`. */
export interface ChatRejectedMessage {
  reason: ChatRejectReason;
}

/** Payload of `ClientMessage.ChatMute`. */
export interface ChatMuteMessage {
  sessionId: string;
  muted: boolean;
}

/** Payload of `ClientMessage.ChatBlock`. */
export interface ChatBlockMessage {
  sessionId: string;
}

/** Payload of `ClientMessage.ChatUnblock`. */
export interface ChatUnblockMessage {
  uid: string;
}

export const CHAT_REPORT_REASONS = ["spam", "harassment", "inappropriate", "other"] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

/** Payload of `ClientMessage.ChatReport`. */
export interface ChatReportMessage {
  /** The reported player's session id (as the line's `from` names it). */
  sessionId: string;
  /** The reported line, when the report is about one. */
  messageId?: string;
  reason: ChatReportReason;
}

/** Payload of `ServerMessage.ChatReported`. */
export interface ChatReportedMessage {
  ok: boolean;
}

/** A player on someone's block list. */
export interface BlockedPlayer {
  uid: string;
  name: string;
}

/** Payload of `ServerMessage.ChatSafety`. */
export interface ChatSafetyMessage {
  /** Session ids in this shard whose chat the player muted. */
  muted: string[];
  /** Everyone the player blocked (online or not). */
  blocked: BlockedPlayer[];
}

export const CLIENT_MESSAGE_TYPES: readonly ClientMessage[] = Object.values(ClientMessage);

export function isClientMessage(type: unknown): type is ClientMessage {
  return typeof type === "string" && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(type);
}
