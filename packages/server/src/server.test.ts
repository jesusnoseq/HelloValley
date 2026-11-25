import type { AddressInfo } from "node:net";
import type { Server } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import { ClientMessage, RoomName, ServerMessage, type UserProfile, type WelcomeMessage } from "@hellovalley/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "./auth/idToken";
import { readConfig } from "./config";
import { createMemoryProfileStore } from "./profiles/profileStore";
import { createGameServer } from "./server";

let server: Server;
let baseUrl: string;

/** Test tokens look like `valid:<uid>`; anything else is rejected. */
const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};
const profileOf = (name: string): UserProfile => ({
  name,
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "6D",
  nativeLang: "en",
  targetLangs: ["ja"],
  style: "japanese",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});
/** alice and bob have finished onboarding; carol has not. */
const profiles = createMemoryProfileStore({ alice: profileOf("Alice"), bob: profileOf("Bob") });
const join = (uid = "alice") => new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: `valid:${uid}` });

beforeAll(async () => {
  server = createGameServer({ verifier: fakeVerifier, profiles });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const ping = (room: Room) => new Promise<number>((resolve) => room.ping(resolve));

describe("game server", () => {
  it("serves the health check", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("joins the town room, answers pings and tracks the player in state", async () => {
    const room = await join();
    try {
      expect(room.sessionId).toBeTruthy();
      expect(await ping(room)).toBeGreaterThanOrEqual(0);
      await new Promise<void>((resolve) => {
        if (room.state?.players?.has(room.sessionId)) resolve();
        else room.onStateChange.once(() => resolve());
      });
      expect(room.state.players.has(room.sessionId)).toBe(true);
    } finally {
      await room.leave();
    }
  });

  it("drops invalid messages without disconnecting the client", async () => {
    const room = await join();
    try {
      room.send(ClientMessage.Chat, { text: "" });
      room.send(ClientMessage.PlayerInput, { kind: "move", dir: { x: 9, z: 0 } });
      room.send(ClientMessage.Interact, { targetKind: "npc", targetId: "baker" });
      expect(await ping(room)).toBeGreaterThanOrEqual(0);
      expect(room.connection.isOpen).toBe(true);
    } finally {
      await room.leave();
    }
  });

  it("rejects malformed join options", async () => {
    await expect(new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: 42 })).rejects.toThrow();
  });
});

describe("authentication", () => {
  it("joins with a verified uid and tells the client which one", async () => {
    const room = await new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: "valid:bob" });
    try {
      const welcome = await new Promise<WelcomeMessage>((resolve) => room.onMessage(ServerMessage.Welcome, resolve));
      expect(welcome).toEqual({ uid: "bob" });
    } finally {
      await room.leave();
    }
  });

  it("rejects joins without a token or with an invalid one", async () => {
    await expect(new Client(baseUrl).joinOrCreate(RoomName.Town, {})).rejects.toThrow(/invalid join options/);
    await expect(new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: "forged" })).rejects.toThrow(
      /invalid ID token/,
    );
  });

  it("rejects players who have not finished onboarding", async () => {
    await expect(join("carol")).rejects.toThrow(/onboarding required/);
  });

  it("requires a valid bearer token on /api/*", async () => {
    expect((await fetch(`${baseUrl}/api/anything`)).status).toBe(401);
    const forged = await fetch(`${baseUrl}/api/anything`, { headers: { authorization: "Bearer forged" } });
    expect(forged.status).toBe(401);
    // Authenticated requests reach the router (unknown routes 404).
    const ok = await fetch(`${baseUrl}/api/anything`, { headers: { authorization: "Bearer valid:alice" } });
    expect(ok.status).toBe(404);
  });
});

describe("readConfig", () => {
  it("defaults to the local dev address", () => {
    expect(readConfig({})).toMatchObject({ port: 2567, host: "127.0.0.1" });
  });

  it("reads PORT and HOST", () => {
    expect(readConfig({ PORT: "8080", HOST: "0.0.0.0" })).toMatchObject({ port: 8080, host: "0.0.0.0" });
  });

  it("rejects an invalid PORT", () => {
    expect(() => readConfig({ PORT: "http" })).toThrow(/PORT/);
  });
});
