import type { OnboardingRequestInput } from "@hellovalley/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError, getShards, postOnboarding, putAppearance } from "./api";

const user = { getIdToken: async () => "tok" };
const request: OnboardingRequestInput = {
  name: "Lia",
  nativeLang: "en",
  targetLang: "ja",
  selfAssessment: "basics",
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "mint" }, trousers: { swatch: "navy" } },
  style: "japanese",
};
const profile = {
  name: "Lia",
  animal: "fox",
  colors: request.colors,
  apartmentId: "6D",
  nativeLang: "en",
  targetLangs: ["ja"],
  style: "japanese",
};

const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body }));

describe("postOnboarding", () => {
  it("posts the request with the ID token and parses the profile", async () => {
    const fetchImpl = reply(201, { created: true, profile });
    const res = await postOnboarding(user, request, { baseUrl: "http://srv/", fetchImpl });
    expect(res).toEqual({ created: true, profile });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://srv/api/onboarding");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it("surfaces server error codes", async () => {
    await expect(postOnboarding(user, request, { fetchImpl: reply(422, { error: "name_rejected" }) })).rejects.toMatchObject({
      code: "name_rejected",
      status: 422,
    });
    await expect(postOnboarding(user, request, { fetchImpl: reply(502, "<html>") })).rejects.toMatchObject({
      code: "http_error",
      status: 502,
    });
  });

  it("reports network failures and malformed answers", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(postOnboarding(user, request, { fetchImpl: down })).rejects.toMatchObject({ code: "network", status: null });
    const bad = postOnboarding(user, request, { fetchImpl: reply(200, { created: true, profile: { ...profile, apartmentId: "0Z" } }) });
    await expect(bad).rejects.toBeInstanceOf(ApiError);
    await expect(bad).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("putAppearance", () => {
  const look = { animal: "rabbit", colors: { fur: "cocoa", shirt: { h: 20, s: 0.5, l: 0.7 }, trousers: { swatch: "navy" } } } as const;

  it("puts the appearance with the ID token and parses the updated profile", async () => {
    const updated = { ...profile, ...look };
    const fetchImpl = reply(200, { profile: updated });
    const res = await putAppearance(user, look, { baseUrl: "http://srv", fetchImpl });
    expect(res.profile).toEqual(updated);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://srv/api/profile/appearance");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual(look);
  });

  it("surfaces errors and rejects malformed profiles", async () => {
    await expect(putAppearance(user, look, { fetchImpl: reply(404, { error: "not_onboarded" }) })).rejects.toMatchObject({ code: "not_onboarded", status: 404 });
    await expect(putAppearance(user, look, { fetchImpl: reply(200, { profile: { ...profile, animal: "dragon" } }) })).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("getShards", () => {
  const shard = { roomId: "r1", shard: 2, clients: 3, maxClients: 40 };

  it("gets the shard list with the ID token and a friend query", async () => {
    const fetchImpl = reply(200, { shards: [shard], friend: shard });
    const res = await getShards(user, "u_3", { baseUrl: "http://srv", fetchImpl });
    expect(res.friend).toEqual(shard);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://srv/api/shards?friend=u_3");
    expect(init).toEqual({ method: "GET", headers: { authorization: "Bearer tok" } });
  });

  it("omits the query without a friend and rejects malformed answers", async () => {
    const fetchImpl = reply(200, { shards: [], friend: null });
    await getShards(user, undefined, { baseUrl: "http://srv", fetchImpl });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("http://srv/api/shards");
    await expect(getShards(user, "x", { fetchImpl: reply(200, { shards: [{ ...shard, shard: 0 }], friend: null }) })).rejects.toMatchObject({ code: "bad_response" });
  });
});
