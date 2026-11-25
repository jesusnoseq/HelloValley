import type { AddressInfo } from "node:net";
import type { Server } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import { ClientMessage, RoomName } from "@hellovalley/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readConfig } from "./config";
import { createGameServer } from "./server";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createGameServer();
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
    const room = await new Client(baseUrl).joinOrCreate(RoomName.Town, {});
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
    const room = await new Client(baseUrl).joinOrCreate(RoomName.Town, {});
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

describe("readConfig", () => {
  it("defaults to the local dev address", () => {
    expect(readConfig({})).toEqual({ port: 2567, host: "127.0.0.1" });
  });

  it("reads PORT and HOST", () => {
    expect(readConfig({ PORT: "8080", HOST: "0.0.0.0" })).toEqual({ port: 8080, host: "0.0.0.0" });
  });

  it("rejects an invalid PORT", () => {
    expect(() => readConfig({ PORT: "http" })).toThrow(/PORT/);
  });
});
