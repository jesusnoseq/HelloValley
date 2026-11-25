/** Colyseus room names registered by the server (architecture §7.1). */
export const RoomName = {
  Town: "town",
  // TODO(M17): Apartment: "apartment" (one private ApartmentRoom per owner).
} as const;
export type RoomName = (typeof RoomName)[keyof typeof RoomName];

/** Messages the client sends to a room. Payload schemas are in `schemas.ts`. */
export const ClientMessage = {
  /** Movement input: a WASD direction or a click-to-move target. */
  PlayerInput: "player:input",
  /** A proximity chat line typed by the player. */
  Chat: "chat:send",
  /** Talk to an NPC or use a world object (F / click). */
  Interact: "interact:request",
  // TODO(M21): "npc:reply" (the untrusted NPC turn proposal, architecture §5.3).
} as const;
export type ClientMessage = (typeof ClientMessage)[keyof typeof ClientMessage];

/** Messages the server sends to one client. */
export const ServerMessage = {
  /** Sent once after a join: the verified Firebase uid the session runs as. */
  Welcome: "session:welcome",
} as const;
export type ServerMessage = (typeof ServerMessage)[keyof typeof ServerMessage];

/** Payload of `ServerMessage.Welcome`. */
export interface WelcomeMessage {
  uid: string;
}

export const CLIENT_MESSAGE_TYPES: readonly ClientMessage[] = Object.values(ClientMessage);

export function isClientMessage(type: unknown): type is ClientMessage {
  return typeof type === "string" && (CLIENT_MESSAGE_TYPES as readonly string[]).includes(type);
}
