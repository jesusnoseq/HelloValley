import type { AddressInfo } from "node:net";
import { Client, type Room } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ClientMessage,
  interiorArrivalPoint,
  PlayerController,
  type PlayerMoveMessage,
  RoomName,
  ServerMessage,
  spaceDoors,
  type UserProfile,
  type WelcomeMessage,
} from "@hellovalley/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Translator } from "../../packages/client/src/ai/translate";
import { createCachedTranslator } from "../../packages/client/src/ai/translate";
import { stubChatModeration } from "../../packages/client/src/ai/moderation";
import { createChatSession } from "../../packages/client/src/net/chatSession";
import { InvalidIdTokenError } from "../../packages/server/src/auth/idToken";
import { createMemoryProfileStore } from "../../packages/server/src/profiles/profileStore";
import { createGameServer, type GameServer } from "../../packages/server/src/server";

/**
 * The client's chat pipeline (packages/client/src/net/chatSession.ts) against a real game server
 * in Node (build plan M18 acceptance): two players with different target languages each see the
 * other's line in their own target language. The translator is a fake that tags the target
 * language (the real one is M20's hybrid AI module); auth is mocked (`valid:<uid>` tokens).
 */

const profileOf = (name: string, nativeLang: string, targetLang: string): UserProfile => ({
  name,
  animal: "cat",
  colors: { fur: "ginger", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "3C",
  nativeLang,
  targetLangs: [targetLang],
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
    // Aiko speaks English and learns Japanese; Luis speaks Spanish and learns English.
    profiles: createMemoryProfileStore({ aiko: profileOf("Aiko", "en", "ja"), luis: profileOf("Luis", "es", "en") }),
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

/** Walks a fresh player out of their apartment into the town, reporting like the game client. */
async function walkIntoTown(room: Room): Promise<void> {
  const start = interiorArrivalPoint("apartment");
  const controller = new PlayerController(start);
  let seq = 0;
  const report = () => {
    const { space, pos, heading, motion } = controller.state;
    const move: PlayerMoveMessage = { seq: ++seq, epoch: 0, space, x: pos[0], z: pos[1], heading, motion };
    room.send(ClientMessage.PlayerMove, move);
  };
  expect(controller.clickTo(spaceDoors("apartment")[0]!.centre)).toBe(true);
  let last = performance.now();
  for (let k = 0; k < 120 && controller.state.space !== "town"; k++) {
    await sleep(50);
    const now = performance.now();
    if (controller.update((now - last) / 1000)) {
      report();
      controller.completeTransition();
    }
    last = now;
    report();
  }
  expect(controller.state.space).toBe("town");
  report();
}

const tagging: Translator = { translate: async (r) => ({ ok: true, text: `[${r.to}] ${r.text}`, via: "on-device" }) };

describe("chat pipeline against the server", () => {
  it("shows each player the other's line in their own target language", async () => {
    const sessions = { aiko: createChatSession({ translator: createCachedTranslator(tagging), moderation: stubChatModeration }), luis: createChatSession({ translator: createCachedTranslator(tagging), moderation: stubChatModeration }) };
    sessions.aiko.setReader({ targetLang: "ja", nativeLang: "en" });
    sessions.luis.setReader({ targetLang: "en", nativeLang: "es" });
    const rooms: Room[] = [];
    try {
      for (const uid of ["aiko", "luis"] as const) {
        const room = await new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: `valid:${uid}` });
        rooms.push(room);
        sessions[uid].attach(room);
        await new Promise<WelcomeMessage>((resolve) => room.onMessage(ServerMessage.Welcome, resolve));
      }
      await Promise.all(rooms.map(walkIntoTown));

      // Luis types in Spanish (his native language), Aiko in Japanese (her target language).
      expect(await sessions.luis.send("¡Hola a todos!", "es")).toBe("sent");
      const aikoLines = () => sessions.aiko.store.getState().lines;
      const luisLines = () => sessions.luis.store.getState().lines;
      await until(() => aikoLines()[0]?.shown.status === "translated" && luisLines()[0]?.shown.status === "translated", "both to read luis's line");
      expect(aikoLines()[0]!.shown.text).toBe("[ja] ¡Hola a todos!");
      expect(luisLines()[0]!.shown.text).toBe("[en] ¡Hola a todos!");
      // Aiko's hover: the original plus an English translation.
      sessions.aiko.requestHover(aikoLines()[0]!.id);
      await until(() => aikoLines()[0]!.hover.status === "ready", "aiko's hover translation");
      expect(aikoLines()[0]!.hover.text).toBe("[en] ¡Hola a todos!");

      expect(await sessions.aiko.send("こんにちは", "ja")).toBe("sent");
      await until(() => aikoLines().length === 2 && luisLines()[1]?.shown.status === "translated", "both to read aiko's line");
      // Written in Aiko's target language: she sees it as written; Luis reads it in English.
      expect(aikoLines()[1]!.shown).toEqual({ status: "original", text: "こんにちは" });
      expect(luisLines()[1]!.shown.text).toBe("[en] こんにちは");
      expect(luisLines()[1]!.plan.hover).toEqual({ translateTo: "es" });
    } finally {
      await Promise.all(rooms.map((r) => r.leave()));
    }
    expect(sessions.aiko.store.getState().online).toBe(false);
  }, 30_000);
});
