import type { AddressInfo } from "node:net";
import { Client } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import { ClientMessage, RoomName, type UserProfile, weatherAt, WORLD_WEATHER_SEED, worldPhaseAt } from "@hellovalley/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MoveSync } from "../../packages/client/src/net/moveSync";
import { attachTownRoom, townLive, townSession } from "../../packages/client/src/net/townSession";
import { InvalidIdTokenError } from "../../packages/server/src/auth/idToken";
import { createMemoryProfileStore } from "../../packages/server/src/profiles/profileStore";
import { TOWN_SPAWN } from "../../packages/server/src/rooms/TownRoom";
import { createGameServer, type GameServer } from "../../packages/server/src/server";

/**
 * The client's room mirror (packages/client/src/net/townSession.ts) against a real game server in
 * Node (build plan M16): remote players, interpolation tracks, the synced clock, the broadcast
 * weather and corrections. Auth is mocked (`valid:<uid>` tokens).
 */

const profileOf = (name: string): UserProfile => ({
  name,
  animal: "rabbit",
  colors: { fur: "white", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "2B",
  nativeLang: "es",
  targetLangs: ["en"],
  style: "european",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
});

let server: GameServer;
let baseUrl: string;

beforeAll(async () => {
  server = createGameServer({
    verifier: {
      verify: async (token) => {
        const uid = /^valid:([a-z]+)$/.exec(token)?.[1];
        if (!uid) throw new InvalidIdTokenError();
        return { uid, admin: false };
      },
    },
    profiles: createMemoryProfileStore({ lia: profileOf("Lia"), noa: profileOf("Noa") }),
  });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

describe("townSession mirror", () => {
  it("mirrors other players, syncs the clock and the weather, and queues corrections", async () => {
    const lia = await new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: "valid:lia" });
    let shard: number | null = null;
    const detach = attachTownRoom(lia, (w) => (shard = w.shard));
    const noa = await new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: "valid:noa" });
    try {
      await until(() => shard !== null && townLive.spawn !== null, "the welcome");
      expect(townLive.spawn).toMatchObject({ space: "apartment" });
      expect(townLive.welcomed).toBe(true);
      expect(townSession.getState().shard).toBe(shard);

      // Noa shows up as a remote player with her name and look.
      await until(() => noa.sessionId in townSession.getState().remotes, "noa in the mirror");
      const info = townSession.getState().remotes[noa.sessionId]!;
      expect(info).toMatchObject({ name: "Noa", space: "apartment" });
      expect(JSON.parse(info.appearance)).toMatchObject({ animal: "rabbit" });
      expect(lia.sessionId in townSession.getState().remotes).toBe(false);

      // Noa takes a few steps: the track fills with snapshots.
      const sync = new MoveSync();
      const [x0, z0] = TOWN_SPAWN.pos;
      for (let k = 1; k <= 5; k++) {
        const move = sync.next({ space: "apartment", pos: [x0 + k * 0.1, z0], heading: 0, motion: k < 5 ? "walk" : "idle" }, k * 60);
        noa.send(ClientMessage.PlayerMove, move);
        await sleep(60);
      }
      await until(() => Math.abs((townLive.tracks.get(noa.sessionId)?.latest?.x ?? 0) - (x0 + 0.5)) < 1e-4, "noa's last step");
      const track = townLive.tracks.get(noa.sessionId)!;
      expect(track.size).toBeGreaterThanOrEqual(3);
      expect(track.latest?.motion).toBe("idle");

      // The clock is synced to the server (same machine: offset near zero) and the weather mirrored.
      await until(() => townLive.serverNow() !== null, "clock sync");
      expect(Math.abs(townLive.serverNow()! - Date.now())).toBeLessThan(250);
      expect(Math.abs(worldPhaseAt(townLive.serverNow()!) - worldPhaseAt(Date.now()))).toBeLessThan(1e-3);
      await until(() => townLive.serverWeather() !== null, "weather");
      expect(townLive.serverWeather()).toBe(weatherAt(Date.now(), WORLD_WEATHER_SEED).weather);

      // A rejected report reaches the correction queue.
      lia.send(ClientMessage.PlayerMove, { seq: 1, epoch: 0, space: "town", x: 30, z: 30, heading: 0, motion: "run" });
      await until(() => townLive.corrections.length === 1, "a correction");
      expect(townLive.corrections[0]).toMatchObject({ epoch: 1, reason: "space", space: "apartment" });

      // Noa leaves: the mirror forgets her.
      await noa.leave();
      await until(() => !(noa.sessionId in townSession.getState().remotes), "noa to leave the mirror");
      expect(townLive.tracks.has(noa.sessionId)).toBe(false);
    } finally {
      if (noa.connection.isOpen) await noa.leave();
      await lia.leave();
      detach();
    }
    expect(townSession.getState().room).toBeNull();
    expect(townLive.serverNow()).toBeNull();
  });
});
