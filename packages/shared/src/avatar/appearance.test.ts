import { describe, expect, it } from "vitest";
import { ANIMALS } from "../data/animals";
import { PASTEL_LIGHTNESS, PASTEL_SATURATION } from "../data/palette";
import { ApiRoute } from "../onboarding/onboarding";
import {
  AppearanceUpdateRequestSchema,
  AppearanceUpdateResponseSchema,
  appearanceHex,
  appearanceOf,
  AvatarAppearanceSchema,
  sameAppearance,
  withAppearance,
} from "./appearance";

const fox = { animal: "fox", colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } } } as const;
const profile = { name: "Lia", ...fox, apartmentId: "6D", nativeLang: "en", targetLangs: ["ja"], style: "japanese" } as const;

describe("avatar appearance", () => {
  it("accepts every animal with each of its own fur tints", () => {
    for (const animal of ANIMALS) {
      for (const tint of animal.furTints) {
        const r = AvatarAppearanceSchema.safeParse({ animal: animal.id, colors: { fur: tint.id, shirt: { swatch: "mint" }, trousers: { swatch: "sand" } } });
        expect(r.success, `${animal.id}/${tint.id}`).toBe(true);
      }
    }
  });

  it("rejects a fur tint of another animal, unknown animals and extra fields", () => {
    expect(AvatarAppearanceSchema.safeParse({ ...fox, colors: { ...fox.colors, fur: "snow" } }).success).toBe(false);
    expect(AvatarAppearanceSchema.safeParse({ ...fox, animal: "dragon" }).success).toBe(false);
    expect(AppearanceUpdateRequestSchema.safeParse({ ...fox, name: "Mallory" }).success).toBe(false);
    expect(AppearanceUpdateRequestSchema.safeParse({ ...fox, apartmentId: "1A" }).success).toBe(false);
    expect(AppearanceUpdateRequestSchema.safeParse({ ...fox, colors: { ...fox.colors, shirt: { swatch: "neon" } } }).success).toBe(false);
  });

  it("clamps custom HSL colours into the pastel range", () => {
    const parsed = AppearanceUpdateRequestSchema.parse({ ...fox, colors: { ...fox.colors, shirt: { h: 400, s: 1, l: 0.1 }, trousers: { h: -30, s: 0, l: 1 } } });
    expect(parsed.colors.shirt).toEqual({ h: 40, s: PASTEL_SATURATION.max, l: PASTEL_LIGHTNESS.min });
    expect(parsed.colors.trousers).toEqual({ h: 330, s: PASTEL_SATURATION.min, l: PASTEL_LIGHTNESS.max });
  });

  it("resolves hex colours, with the animal's first tint for an unknown fur", () => {
    expect(appearanceHex(fox)).toEqual({ fur: "#c8693a", shirt: "#aed6ef", trousers: "#4a5878" });
    expect(appearanceHex({ ...fox, colors: { ...fox.colors, fur: "nope" } }).fur).toBe("#c8693a");
    expect(appearanceHex({ ...fox, colors: { ...fox.colors, shirt: { h: 0, s: 0.5, l: 0.75 } } }).shirt).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("reads and replaces the appearance of a profile", () => {
    expect(appearanceOf(profile)).toEqual(fox);
    const otter = AvatarAppearanceSchema.parse({ animal: "otter", colors: { fur: "chestnut", shirt: { swatch: "peach" }, trousers: { h: 120, s: 0.5, l: 0.75 } } });
    const next = withAppearance(profile, otter);
    expect(next).toMatchObject({ name: "Lia", apartmentId: "6D", animal: "otter", colors: otter.colors });
    expect(AppearanceUpdateResponseSchema.parse({ profile: next }).profile.animal).toBe("otter");
  });

  it("compares appearances", () => {
    expect(sameAppearance(fox, { ...fox, colors: { ...fox.colors } })).toBe(true);
    expect(sameAppearance(fox, { ...fox, colors: { ...fox.colors, fur: "amber" } })).toBe(false);
    expect(sameAppearance(fox, { ...fox, colors: { ...fox.colors, shirt: { swatch: "mint" } } })).toBe(false);
  });

  it("has an API route", () => {
    expect(ApiRoute.Appearance).toBe("/api/profile/appearance");
  });
});
