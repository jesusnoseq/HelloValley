import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RoomName } from "@hellovalley/shared";
import { registerHttpRoutes } from "./http";
import { TownRoom } from "./rooms/TownRoom";

/** One process: Colyseus rooms plus the Express HTTP API on the same port (architecture §3.1, §7). */
export function createGameServer(): Server {
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: registerHttpRoutes,
    greet: false,
  });
  // TODO(M16): shard filling ("fill existing shards first") and join-a-friend lookup.
  server.define(RoomName.Town, TownRoom);
  // TODO(M17): server.define(RoomName.Apartment, ApartmentRoom).
  return server;
}
