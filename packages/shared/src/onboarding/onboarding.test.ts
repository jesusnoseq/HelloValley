import { describe, expect, it } from "vitest";
import { ANIMALS } from "../data/animals";
import { isApartmentId } from "../data/apartment";
import { CEFR_LEVELS } from "../data/difficulty";
import { PASTEL_LIGHTNESS, PASTEL_SATURATION } from "../data/palette";
import { PlayerProfileSchema, toPlayerProfile, UserProfileSchema } from "../firestore/schemas";
import {
  buildOnboardingRecords,
  levelForSelfAssessment,
  type OnboardingRequestInput,
  OnboardingRequestSchema,
  OnboardingResponseSchema,
  SELF_ASSESSMENTS,
  STARTING_COINS,
} from "./onboarding";

const ts = { seconds: 1_790_000_000, nanoseconds: 0 };

const request: OnboardingRequestInput = {
  name: "  Lia ",
  nativeLang: "en",
  targetLang: "ja",
  selfAssessment: "basics",
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "mint" }, trousers: { h: 200, s: 0.95, l: 0.2 } },
  style: "japanese",
};

describe("self-assessment", () => {
  it("maps the five GDD §2.1 options to A1..C1 in order", () => {
    expect(SELF_ASSESSMENTS.map((a) => levelForSelfAssessment(a.id))).toEqual(CEFR_LEVELS.slice(0, 5));
  });
});

describe("OnboardingRequestSchema", () => {
  it("accepts a complete request, trims the name and clamps custom colours to pastel", () => {
    const parsed = OnboardingRequestSchema.parse(request);
    expect(parsed.name).toBe("Lia");
    expect(parsed.colors.trousers).toEqual({ h: 200, s: PASTEL_SATURATION.max, l: PASTEL_LIGHTNESS.min });
  });

  it("rejects the same native and target language", () => {
    expect(OnboardingRequestSchema.safeParse({ ...request, targetLang: "en" }).success).toBe(false);
  });

  it("rejects a fur tint of another animal and unknown ids", () => {
    const wrongFur = { ...request, animal: "frog", colors: { ...request.colors, fur: "russet" } };
    expect(OnboardingRequestSchema.safeParse(wrongFur).success).toBe(false);
    expect(OnboardingRequestSchema.safeParse({ ...request, animal: "dragon" }).success).toBe(false);
    expect(OnboardingRequestSchema.safeParse({ ...request, targetLang: "xx" }).success).toBe(false);
    expect(OnboardingRequestSchema.safeParse({ ...request, style: "gothic" }).success).toBe(false);
    expect(OnboardingRequestSchema.safeParse({ ...request, selfAssessment: "expert" }).success).toBe(false);
  });

  it("rejects names that are too short, too long or contain control characters", () => {
    for (const name of ["A", " B ", "x".repeat(17), "Li\u0000a"]) {
      expect(OnboardingRequestSchema.safeParse({ ...request, name }).success).toBe(false);
    }
  });

  it("rejects server-owned fields (the server assigns the apartment and coins)", () => {
    for (const extra of [{ apartmentId: "1A" }, { coins: 9999 }, { level: "C2" }, { createdAt: ts }]) {
      expect(OnboardingRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    }
  });

  it("accepts every animal with each of its own tints", () => {
    for (const a of ANIMALS) {
      for (const t of a.furTints) {
        const r = { ...request, animal: a.id, colors: { ...request.colors, fur: t.id } };
        expect(OnboardingRequestSchema.safeParse(r).success).toBe(true);
      }
    }
  });
});

describe("buildOnboardingRecords", () => {
  const parsed = OnboardingRequestSchema.parse(request);

  it("creates a valid profile and language progress", () => {
    const { profile, lang } = buildOnboardingRecords(parsed, { apartmentId: "6D", now: ts });
    expect(UserProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile).toMatchObject({ name: "Lia", apartmentId: "6D", nativeLang: "en", targetLangs: ["ja"], style: "japanese" });
    expect(profile.createdAt).toBe(ts);
    expect(lang).toEqual({
      code: "ja",
      progress: { level: "A2", levelEstimate: 2, streak: 0, coins: STARTING_COINS, hearts: {}, settings: {} },
    });
  });

  it("stores language codes in their canonical casing", () => {
    const r = OnboardingRequestSchema.parse({ ...request, nativeLang: "es", targetLang: "zh-Hant" });
    expect(buildOnboardingRecords(r, { apartmentId: "1A", now: ts }).lang.code).toBe("zh-Hant");
  });

  it("rejects an invalid apartment id", () => {
    expect(() => buildOnboardingRecords(parsed, { apartmentId: "0Z" as "1A", now: ts })).toThrow();
  });

  it("round-trips through the API response schema", () => {
    const { profile } = buildOnboardingRecords(parsed, { apartmentId: "9H", now: ts });
    const player = toPlayerProfile(profile);
    expect(player).not.toHaveProperty("createdAt");
    expect(isApartmentId(player.apartmentId)).toBe(true);
    const body = JSON.parse(JSON.stringify({ created: true, profile: player }));
    expect(OnboardingResponseSchema.parse(body).profile).toEqual(player);
    expect(PlayerProfileSchema.safeParse({ ...player, createdAt: ts }).success).toBe(false);
  });
});
