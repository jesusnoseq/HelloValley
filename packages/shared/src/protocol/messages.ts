// Type-only imports: this module stays free of zod so the client's entry chunk can use it.
import type { Emote } from "../avatar/animation";
import type { Weather } from "../data/world";
import type { Motion, SpaceId } from "../world/player";

/** Colyseus room names registered by the server (architecture §7.1). */
export const RoomName = {
  Town: "town",
  // TODO(M17): Apartment: "apartment" (one private ApartmentRoom per owner).
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
  /** A proximity chat line typed by the player. */
  Chat: "chat:send",
  /** Talk to an NPC or use a world object (F / click). */
  Interact: "interact:request",
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
} as const;
export type ServerMessage = (typeof ServerMessage)[keyof typeof ServerMessage];

/** Close code when a newer session of the same uid (another tab) replaced this one. Do not rejoin. */
export const SESSION_REPLACED_CODE = 4801;

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

export type MoveRejectReason = "speed" | "blocked" | "space";

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

export const CLIENT_MESSAGE_TYPES: readonly ClientMessage[] = Object.values(ClientMessage);

export function isClientMessage(type: unknown): type is ClientMessage {
  return typeof type === "string" && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(type);
}
