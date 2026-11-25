import type { AddressInfo } from "node:net";
import type { Server } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import type { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ApiRoute,
  type OnboardingRequestInput,
  OnboardingResponseSchema,
  RoomName,
  STARTING_COINS,
} from "@hellovalley/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type IdTokenVerifier, InvalidIdTokenError } from "../auth/idToken";
import type { NameModerator } from "../moderation/names";
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

const request: OnboardingRequestInput = {
  name: "Lia",
  nativeLang: "es",
  targetLang: "ja",
  selfAssessment: "simple_chat",
  animal: "otter",
  colors: { fur: "chestnut", shirt: { swatch: "peach" }, trousers: { h: 120, s: 0.5, l: 0.75 } },
  style: "japanese",
};

let server: Server;
let baseUrl: string;
let store: MemoryProfileStore;
let failing = false;
const blocked = new Set(["Badname"]);
const moderate: NameModerator = async (name) => (blocked.has(name) ? { ok: false, reason: "blocked" } : { ok: true });
let draws = 0;

/** Delegates to the current memory store, or fails like an unreachable Firestore. */
const profiles: ProfileStore = {
  getProfile: (uid) => (failing ? Promise.reject(new Error("unavailable")) : store.getProfile(uid)),
  createProfile: (uid, records) => store.createProfile(uid, records),
  updateAppearance: (uid, appearance) => (failing ? Promise.reject(new Error("unavailable")) : store.updateAppearance(uid, appearance)),
};

beforeAll(async () => {
  server = createGameServer({
    verifier: fakeVerifier,
    profiles,
    onboarding: { moderateName: moderate, drawApartment: () => (draws++ === 0 ? "6D" : "1A") },
  });
  await server.listen(0, "127.0.0.1");
  const { port } = (server.transport as WebSocketTransport).server!.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

beforeEach(() => {
  store = createMemoryProfileStore();
  failing = false;
  draws = 0;
});

function post(body: unknown, { uid = "lia", raw }: { uid?: string; raw?: string } = {}) {
  return fetch(`${baseUrl}${ApiRoute.Onboarding}`, {
    method: "POST",
    headers: { authorization: `Bearer valid:${uid}`, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("POST /api/onboarding", () => {
  it("creates the profile and the first language with a server-assigned apartment", async () => {
    const res = await post(request);
    expect(res.status).toBe(201);
    const body = OnboardingResponseSchema.parse(await res.json());
    expect(body.created).toBe(true);
    expect(body.profile).toEqual({
      name: "Lia",
      animal: "otter",
      colors: request.colors,
      apartmentId: "6D",
      nativeLang: "es",
      targetLangs: ["ja"],
      style: "japanese",
    });
    expect(store.profiles.get("lia")?.createdAt.seconds).toBeGreaterThan(1_700_000_000);
    expect(store.langs.get("users/lia/langs/ja")).toEqual({
      level: "B1",
      levelEstimate: 4,
      streak: 0,
      coins: STARTING_COINS,
      hearts: {},
      settings: {},
    });
    // Colyseus answers every request with CORS headers for the calling origin.
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  });

  it("is idempotent: a second submit keeps the first apartment and data", async () => {
    await post(request);
    const again = await post({ ...request, name: "Other", animal: "fox", colors: { ...request.colors, fur: "russet" } });
    expect(again.status).toBe(200);
    const body = OnboardingResponseSchema.parse(await again.json());
    expect(body).toMatchObject({ created: false, profile: { name: "Lia", apartmentId: "6D", animal: "otter" } });
    expect(store.profiles.size).toBe(1);
  });

  it("rejects invalid requests with 400 and writes nothing", async () => {
    const bad: unknown[] = [
      { ...request, targetLang: "es" },
      { ...request, name: "x" },
      { ...request, colors: { ...request.colors, fur: "russet" } },
      { ...request, apartmentId: "9H" },
      { ...request, coins: 1000 },
      { ...request, style: undefined },
      [],
      "hello",
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
    expect((await post(null, { raw: "{not json" })).status).toBe(400);
    expect((await post({ ...request, name: "x".repeat(20_000) })).status).toBe(413);
    expect(store.profiles.size).toBe(0);
  });

  it("rejects names the moderation hook blocks with 422", async () => {
    const res = await post({ ...request, name: "Badname" });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "name_rejected" });
    expect(store.profiles.size).toBe(0);
  });

  it("requires a valid ID token and takes the uid from it", async () => {
    const anon = await fetch(`${baseUrl}${ApiRoute.Onboarding}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(anon.status).toBe(401);
    await post(request, { uid: "kenji" });
    expect([...store.profiles.keys()]).toEqual(["kenji"]);
  });

  it("answers 500 when the profile store is down", async () => {
    failing = true;
    const res = await post(request);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("lets the player join the town once onboarded", async () => {
    await expect(new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: "valid:lia" })).rejects.toThrow(
      /onboarding required/,
    );
    await post(request);
    const room = await new Client(baseUrl).joinOrCreate(RoomName.Town, { idToken: "valid:lia" });
    await room.leave();
  });
});
