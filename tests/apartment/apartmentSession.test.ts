import type { AddressInfo } from "node:net";
import { Client } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import { defaultApartmentLayout, RoomName, type UserProfile } from "@hellovalley/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apartmentSession, attachApartmentRoom, joinApartment, sendFurnitureEdit } from "../../packages/client/src/net/apartmentSession";
import { currentApartment } from "../../packages/client/src/scene/apartmentLayout";
import { createMemoryLayoutStore } from "../../packages/server/src/apartments/layoutStore";
import { InvalidIdTokenError } from "../../packages/server/src/auth/idToken";
import { createMemoryProfileStore } from "../../packages/server/src/profiles/profileStore";
import { createGameServer, type GameServer } from "../../packages/server/src/server";

/**
 * The client's ApartmentRoom mirror (packages/client/src/net/apartmentSession.ts) against a real
 * game server in Node (build plan M17): the owner's layout, the occupants' town sessions and the
 * answers to furniture edits. Auth is mocked (`valid:<uid>` tokens).
 */

const profile: UserProfile = {
  name: "Lia",
  animal: "rabbit",
  colors: { fur: "white", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
  apartmentId: "2B",
  nativeLang: "es",
  targetLangs: ["en"],
  style: "european",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
};

let server: GameServer;
let baseUrl: string;
const layouts = createMemoryLayoutStore();

beforeAll(async () => {
  server = createGameServer({
    verifier: {
      verify: async (token) => {
        const uid = /^valid:([a-z]+)$/.exec(token)?.[1];
        if (!uid) throw new InvalidIdTokenError();
        return { uid, admin: false };
      },
    },
    profiles: createMemoryProfileStore({ lia: profile }),
    layouts,
    layoutSaveDebounceMs: 20,
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

describe("apartmentSession mirror", () => {
  it("mirrors the owner's layout and occupants and applies furniture edits", async () => {
    const town = await new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: "valid:lia" });
    const room = await joinApartment(new Client(baseUrl), "valid:lia", "lia");
    const detach = attachApartmentRoom(room, "lia", true);
    try {
      await until(() => apartmentSession.getState().layoutJson !== null, "the layout");
      expect(apartmentSession.getState()).toMatchObject({ owner: "lia", isOwner: true, ownerName: "Lia", apartmentId: "2B", revision: 0 });
      expect(currentApartment().layout).toEqual(defaultApartmentLayout());
      await until(() => apartmentSession.getState().occupants.length === 1, "the occupants");
      expect(apartmentSession.getState().occupants).toEqual([town.sessionId]);

      sendFurnitureEdit({ op: "store", index: 4, itemId: "bed" });
      await until(() => apartmentSession.getState().revision === 1, "the edit");
      expect(apartmentSession.getState().lastResult).toMatchObject({ ok: true });
      expect(currentApartment().layout.stored).toEqual(["bed"]);
      await until(() => layouts.layouts.get("lia")?.stored.length === 1, "the save");

      sendFurnitureEdit({ op: "store", index: 0, itemId: "kitchen_nook" });
      await until(() => apartmentSession.getState().lastResult?.ok === false, "the refusal");
      expect(apartmentSession.getState().lastResult).toMatchObject({ reason: "fixed" });
    } finally {
      detach();
      await room.leave();
      await town.leave();
    }
    expect(apartmentSession.getState().room).toBeNull();
  });
});
