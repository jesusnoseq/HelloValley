import type { AddressInfo } from "node:net";
import type { Server } from "@colyseus/core";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ApiRoute,
  type AppearanceUpdateRequest,
  AppearanceUpdateResponseSchema,
  buildOnboardingRecords,
  OnboardingRequestSchema,
  PASTEL_LIGHTNESS,
  PASTEL_SATURATION,
} from "@hellovalley/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import { createMemoryProfileStore, type MemoryProfileStore, type ProfileStore } from "../profiles/profileStore";
import { createGameServer } from "../server";

/** Test tokens look like `valid:<uid>`. */
const fakeVerifier: IdTokenVerifier = {
  verify: async (token) => {
    const uid = /^valid:([a-z0-9]+)$/.exec(token)?.[1];
    if (!uid) throw new InvalidIdTokenError();
    return { uid, admin: false };
  },
};

const onboarded = buildOnboardingRecords(
  OnboardingRequestSchema.parse({
    name: "Lia",
    nativeLang: "es",
    targetLang: "ja",
    selfAssessment: "simple_chat",
    animal: "otter",
    colors: { fur: "chestnut", shirt: { swatch: "peach" }, trousers: { swatch: "navy" } },
    style: "japanese",
  }),
  { apartmentId: "6D", now: { seconds: 1_790_000_000, nanoseconds: 0 } },
);

const look: AppearanceUpdateRequest = {
  animal: "rabbit",
  colors: { fur: "cocoa", shirt: { swatch: "mint" }, trousers: { h: 200, s: 0.4, l: 0.7 } },
};

let server: Server;
let baseUrl: string;
let store: MemoryProfileStore;
let failing = false;

const profiles: ProfileStore = {
  getProfile: (uid) => store.getProfile(uid),
  createProfile: (uid, records) => store.createProfile(uid, records),
  updateAppearance: (uid, appearance) => (failing ? Promise.reject(new Error("unavailable")) : store.updateAppearance(uid, appearance)),
};

beforeAll(async () => {
  server = createGameServer({ verifier: fakeVerifier, profiles });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

beforeEach(async () => {
  store = createMemoryProfileStore();
  await store.createProfile("lia", onboarded);
  failing = false;
});

function put(body: unknown, { uid = "lia", raw, token }: { uid?: string; raw?: string; token?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://127.0.0.1:5173" };
  if (token !== null) headers.authorization = `Bearer ${token ?? `valid:${uid}`}`;
  return fetch(`${baseUrl}${ApiRoute.Appearance}`, { method: "PUT", headers, body: raw ?? JSON.stringify(body) });
}

describe("PUT /api/profile/appearance", () => {
  it("saves the new appearance and returns the whole profile", async () => {
    const res = await put(look);
    expect(res.status).toBe(200);
    const { profile } = AppearanceUpdateResponseSchema.parse(await res.json());
    expect(profile).toEqual({
      name: "Lia",
      animal: "rabbit",
      colors: look.colors,
      apartmentId: "6D",
      nativeLang: "es",
      targetLangs: ["ja"],
      style: "japanese",
    });
    const stored = store.profiles.get("lia")!;
    expect(stored).toMatchObject({ animal: "rabbit", colors: look.colors, name: "Lia", apartmentId: "6D" });
    expect(stored.createdAt.seconds).toBe(1_790_000_000);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  });

  it("clamps custom colours to the pastel range before storing them", async () => {
    const res = await put({ ...look, colors: { ...look.colors, shirt: { h: 725, s: 1, l: 0.05 } } });
    expect(res.status).toBe(200);
    expect(store.profiles.get("lia")!.colors.shirt).toEqual({ h: 5, s: PASTEL_SATURATION.max, l: PASTEL_LIGHTNESS.min });
  });

  it("rejects invalid bodies with 400 and changes nothing", async () => {
    const bad: unknown[] = [
      { ...look, colors: { ...look.colors, fur: "russet" } },
      { ...look, animal: "dragon" },
      { ...look, name: "Mallory" },
      { ...look, apartmentId: "1A" },
      { ...look, coins: 9999 },
      { ...look, colors: { ...look.colors, shirt: { swatch: "neon" } } },
      { animal: "rabbit" },
      [],
      "rabbit",
    ];
    for (const body of bad) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
    expect((await put(null, { raw: "{nope" })).status).toBe(400);
    expect((await put({ ...look, pad: "x".repeat(20_000) })).status).toBe(413);
    expect(store.profiles.get("lia")).toMatchObject({ animal: "otter", name: "Lia" });
  });

  it("answers 404 before onboarding", async () => {
    const res = await put(look, { uid: "kenji" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_onboarded" });
    expect(store.profiles.has("kenji")).toBe(false);
  });

  it("requires a valid ID token and only writes the caller's own profile", async () => {
    expect((await put(look, { token: null })).status).toBe(401);
    expect((await put(look, { token: "forged" })).status).toBe(401);
    await store.createProfile("kenji", onboarded);
    await put(look, { uid: "kenji" });
    expect(store.profiles.get("kenji")?.animal).toBe("rabbit");
    expect(store.profiles.get("lia")?.animal).toBe("otter");
  });

  it("answers 500 when the profile store is down", async () => {
    failing = true;
    const res = await put(look);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});
