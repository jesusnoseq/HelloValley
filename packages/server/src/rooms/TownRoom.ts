import { type Client, Room, ServerError } from "@colyseus/core";
import {
  ClientMessage,
  type ClientMessagePayloads,
  JoinOptionsSchema,
  type JoinOptions,
  parseClientMessage,
} from "@hellovalley/shared";
import { TownPlayer, TownState } from "./TownState";

/** GDD §4.4 / architecture §7.1: up to 40 players per shard. */
export const TOWN_MAX_CLIENTS = 40;

/**
 * Placeholder town shard. It validates every client message against the shared zod schemas and
 * drops invalid ones, but does not act on them yet.
 */
export class TownRoom extends Room<{ state: TownState }> {
  override maxClients = TOWN_MAX_CLIENTS;
  override state = new TownState();

  override onCreate(): void {
    this.handle(ClientMessage.PlayerInput, (_client, _input) => {
      // TODO(M16): authoritative movement (speed caps, walkability, click-to-move with A*).
    });
    this.handle(ClientMessage.Chat, (_client, _chat) => {
      // TODO(M18): mandatory server moderation, then proximity broadcast.
    });
    this.handle(ClientMessage.Interact, (_client, _request) => {
      // TODO(M19/M21): range check and NPC conversation start (turnId issue, architecture §9).
    });
  }

  override onAuth(_client: Client, options: unknown): JoinOptions {
    const parsed = JoinOptionsSchema.safeParse(options ?? {});
    if (!parsed.success) throw new ServerError(400, "invalid join options");
    // TODO(M03): verify parsed.data.idToken with firebase-admin and return the uid.
    // TODO(M14): reject users who have not finished onboarding.
    return parsed.data;
  }

  override onJoin(client: Client): void {
    // TODO(M11/M16): place the player at the apartment-door spawn point.
    this.state.players.set(client.sessionId, new TownPlayer({ x: 0, z: 0 }));
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }

  /** Registers a handler that only ever sees payloads that passed the shared schema. */
  private handle<K extends ClientMessage>(
    type: K,
    handler: (client: Client, payload: ClientMessagePayloads[K]) => void,
  ): void {
    this.onMessage(type, (client: Client, payload: unknown) => {
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
