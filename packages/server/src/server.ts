import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RoomName } from "@hellovalley/shared";
import { type ApartmentLayoutStore, createMemoryLayoutStore, firestoreLayoutStoreFor } from "./apartments/layoutStore";
import { createFirebaseVerifier, type IdTokenVerifier } from "./auth/idToken";
import { readFirebaseConfig } from "./config";
import { adminApp } from "./firebase/admin";
import { type HttpDeps, registerHttpRoutes } from "./http";
import type { ChatModerator } from "./moderation/chat";
import { createMemorySafetyStore, firestoreSafetyStoreFor, type SafetyStore } from "./safety/safetyStore";
import { firestoreProfileStoreFor, type ProfileStore } from "./profiles/profileStore";
import { apartmentRoomWith } from "./rooms/ApartmentRoom";
import { ApartmentRegistry } from "./rooms/apartmentRegistry";
import { type TownRoomOptions, townRoomWith } from "./rooms/TownRoom";
import { TownRegistry } from "./rooms/townRegistry";

export interface GameServerOptions {
  /** ID token verifier; defaults to firebase-admin with the config from the environment. */
  verifier?: IdTokenVerifier;
  /** Player profiles; defaults to Firestore through firebase-admin. */
  profiles?: ProfileStore;
  /**
   * Apartment furniture layouts; defaults to Firestore through firebase-admin (in memory when both
   * the verifier and the profile store are injected, as in tests).
   */
  layouts?: ApartmentLayoutStore;
  /** ApartmentRoom save debounce in ms (tests use a short one). */
  layoutSaveDebounceMs?: number;
  /** Test hooks for the onboarding route (apartment draw, clock, name moderation). */
  onboarding?: HttpDeps["onboarding"];
  /** TownRoom settings (tests use small shards). */
  town?: TownRoomOptions;
  /**
   * Block lists and reports; defaults to Firestore through firebase-admin (in memory when both
   * the verifier and the profile store are injected, as in tests).
   */
  safety?: SafetyStore;
  /** The mandatory server chat check (tests inject one; default `moderateChat`, a stub until M36). */
  moderateChat?: ChatModerator;
}

export interface GameServer extends Server {
  /** The live TownRoom shards of this server. */
  readonly towns: TownRegistry;
  /** The live ApartmentRooms and visit passes. */
  readonly apartments: ApartmentRegistry;
}

/** One process: Colyseus rooms plus the Express HTTP API on the same port (architecture §3.1, §7). */
export function createGameServer(options: GameServerOptions = {}): GameServer {
  const needsFirebase = !options.verifier || !options.profiles;
  const firebase = needsFirebase ? readFirebaseConfig() : null;
  const verifier = options.verifier ?? createFirebaseVerifier(firebase!);
  const profiles = options.profiles ?? firestoreProfileStoreFor(adminApp(firebase!));
  // With an injected verifier and profile store (tests) there is no Firebase app to fall back on.
  const layouts = options.layouts ?? (firebase ? firestoreLayoutStoreFor(adminApp(firebase)) : createMemoryLayoutStore());
  const safety = options.safety ?? (firebase ? firestoreSafetyStoreFor(adminApp(firebase)) : createMemorySafetyStore());
  const towns = new TownRegistry();
  const apartments = new ApartmentRegistry();
  const httpServer = createServer();
  const server = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
    express: (app) => registerHttpRoutes(app, { verifier, profiles, onboarding: options.onboarding, registry: towns }),
    greet: false,
  });
  // Architecture §7.1: fill existing shards before opening a new one, lowest "Valley #n" first.
  // A full shard is locked by Colyseus, so joinOrCreate creates the next one. Joining a friend's
  // shard goes through GET /api/shards?friend=<uid> and joinById.
  server
    .define(RoomName.Town, townRoomWith({ verifier, profiles, registry: towns, apartments, safety, moderateChat: options.moderateChat }, options.town))
    .sortBy({ "metadata.shard": 1 });
  // Build plan M17: one private ApartmentRoom per owner. Visitors get in with a pass the owner
  // granted at the lobby intercom (TownRoom).
  server
    .define(
      RoomName.Apartment,
      apartmentRoomWith({ verifier, profiles, layouts, apartments, towns, saveDebounceMs: options.layoutSaveDebounceMs }),
    )
    .filterBy(["owner"]);
  return Object.assign(server, { towns, apartments });
}
