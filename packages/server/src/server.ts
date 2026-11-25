import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RoomName } from "@hellovalley/shared";
import { createFirebaseVerifier, type IdTokenVerifier } from "./auth/idToken";
import { readFirebaseConfig } from "./config";
import { registerHttpRoutes } from "./http";
import { townRoomWith } from "./rooms/TownRoom";

export interface GameServerOptions {
  /** ID token verifier; defaults to firebase-admin with the config from the environment. */
  verifier?: IdTokenVerifier;
}

/** One process: Colyseus rooms plus the Express HTTP API on the same port (architecture §3.1, §7). */
export function createGameServer(options: GameServerOptions = {}): Server {
  const verifier = options.verifier ?? createFirebaseVerifier(readFirebaseConfig());
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => registerHttpRoutes(app, verifier),
    greet: false,
  });
  // TODO(M16): shard filling ("fill existing shards first") and join-a-friend lookup.
  server.define(RoomName.Town, townRoomWith(verifier));
  // TODO(M17): server.define(RoomName.Apartment, ApartmentRoom).
  return server;
}
