import type { OnboardingRequestInput } from "@hellovalley/shared";
import { describe, expect, it, vi } from "vitest";
import { ApiError, postOnboarding } from "./api";

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
