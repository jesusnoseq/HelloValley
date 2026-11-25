import { type Client, Room, ServerError } from "@colyseus/core";
import {
  ClientMessage,
  type ClientMessagePayloads,
  JoinOptionsSchema,
  parseClientMessage,
  ServerMessage,
  type WelcomeMessage,
} from "@hellovalley/shared";
import { type IdTokenVerifier, InvalidIdTokenError, type VerifiedUser } from "../auth/idToken";
import { TownPlayer, TownState } from "./TownState";

/** GDD §4.4 / architecture §7.1: up to 40 players per shard. */
export const TOWN_MAX_CLIENTS = 40;

/** What `onAuth` returns; Colyseus keeps it on `client.auth`. */
export interface TownAuth {
  uid: string;
}

export type TownClient = Client<{ auth: TownAuth }>;

/** Rejects every token. Real rooms are created through `townRoomWith(verifier)`. */
const denyAll: IdTokenVerifier = {
  verify: () => Promise.reject(new InvalidIdTokenError()),
};

/**
 * Placeholder town shard. Joining needs a valid Firebase ID token in the join options; the
 * verified uid is the player's identity for everything the server decides. Every client message
 * is validated against the shared zod schemas and invalid ones are dropped.
 */
export class TownRoom extends Room<{ state: TownState; client: TownClient }> {
  override maxClients = TOWN_MAX_CLIENTS;
  override state = new TownState();
  protected verifier: IdTokenVerifier = denyAll;

  override onCreate(): void {
    this.handle(ClientMessage.PlayerInput, (_client, _input) => {
      // TODO(M16): authoritative movement: run the shared PlayerController (world/player.ts:
      // speed caps, collisions with the walkability grid, click-to-move with A*, door links).
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
    // TODO(M14): reject users who have not finished onboarding (no users/{uid} profile yet).
    // TODO(M16): one session per uid (kick or refuse a second tab).
    return { uid: user.uid };
  }

  override onJoin(client: TownClient): void {
    // TODO(M11/M16): place the player at the apartment-door spawn point.
    this.state.players.set(client.sessionId, new TownPlayer({ x: 0, z: 0 }));
    const welcome: WelcomeMessage = { uid: client.auth!.uid };
    client.send(ServerMessage.Welcome, welcome);
  }

  override onLeave(client: TownClient): void {
    this.state.players.delete(client.sessionId);
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

/** A TownRoom class bound to an ID token verifier, for `server.define`. */
export function townRoomWith(verifier: IdTokenVerifier): typeof TownRoom {
  return class extends TownRoom {
    protected override verifier = verifier;
  };
}
