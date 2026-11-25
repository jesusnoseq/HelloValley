import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RoomName } from "@hellovalley/shared";
import { createFirebaseVerifier, type IdTokenVerifier } from "./auth/idToken";
import { readFirebaseConfig } from "./config";
import { adminApp } from "./firebase/admin";
import { type HttpDeps, registerHttpRoutes } from "./http";
import { firestoreProfileStoreFor, type ProfileStore } from "./profiles/profileStore";
import { townRoomWith } from "./rooms/TownRoom";

export interface GameServerOptions {
  /** ID token verifier; defaults to firebase-admin with the config from the environment. */
  verifier?: IdTokenVerifier;
  /** Player profiles; defaults to Firestore through firebase-admin. */
  profiles?: ProfileStore;
  /** Test hooks for the onboarding route (apartment draw, clock, name moderation). */
  onboarding?: HttpDeps["onboarding"];
}

/** One process: Colyseus rooms plus the Express HTTP API on the same port (architecture §3.1, §7). */
export function createGameServer(options: GameServerOptions = {}): Server {
  const needsFirebase = !options.verifier || !options.profiles;
  const firebase = needsFirebase ? readFirebaseConfig() : null;
  const verifier = options.verifier ?? createFirebaseVerifier(firebase!);
  const profiles = options.profiles ?? firestoreProfileStoreFor(adminApp(firebase!));
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => registerHttpRoutes(app, { verifier, profiles, onboarding: options.onboarding }),
    greet: false,
  });
  // TODO(M16): shard filling ("fill existing shards first") and join-a-friend lookup.
  server.define(RoomName.Town, townRoomWith(verifier, profiles));
  // TODO(M17): server.define(RoomName.Apartment, ApartmentRoom).
  return server;
}
