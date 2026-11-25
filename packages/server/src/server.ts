import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RoomName } from "@hellovalley/shared";
import { createFirebaseVerifier, type IdTokenVerifier } from "./auth/idToken";
import { readFirebaseConfig } from "./config";
import { adminApp } from "./firebase/admin";
import { type HttpDeps, registerHttpRoutes } from "./http";
import { firestoreProfileStoreFor, type ProfileStore } from "./profiles/profileStore";
import { type TownRoomOptions, townRoomWith } from "./rooms/TownRoom";
import { TownRegistry } from "./rooms/townRegistry";

export interface GameServerOptions {
  /** ID token verifier; defaults to firebase-admin with the config from the environment. */
  verifier?: IdTokenVerifier;
  /** Player profiles; defaults to Firestore through firebase-admin. */
  profiles?: ProfileStore;
  /** Test hooks for the onboarding route (apartment draw, clock, name moderation). */
  onboarding?: HttpDeps["onboarding"];
  /** TownRoom settings (tests use small shards). */
  town?: TownRoomOptions;
}

export interface GameServer extends Server {
  /** The live TownRoom shards of this server. */
  readonly towns: TownRegistry;
}

/** One process: Colyseus rooms plus the Express HTTP API on the same port (architecture §3.1, §7). */
export function createGameServer(options: GameServerOptions = {}): GameServer {
  const needsFirebase = !options.verifier || !options.profiles;
  const firebase = needsFirebase ? readFirebaseConfig() : null;
  const verifier = options.verifier ?? createFirebaseVerifier(firebase!);
  const profiles = options.profiles ?? firestoreProfileStoreFor(adminApp(firebase!));
  const towns = new TownRegistry();
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => registerHttpRoutes(app, { verifier, profiles, onboarding: options.onboarding, registry: towns }),
    greet: false,
  });
  // Architecture §7.1: fill existing shards before opening a new one, lowest "Valley #n" first.
  // A full shard is locked by Colyseus, so joinOrCreate creates the next one. Joining a friend's
  // shard goes through GET /api/shards?friend=<uid> and joinById.
  server.define(RoomName.Town, townRoomWith(verifier, profiles, towns, options.town)).sortBy({ "metadata.shard": 1 });
  // TODO(M17): server.define(RoomName.Apartment, ApartmentRoom).
  return Object.assign(server, { towns });
}
