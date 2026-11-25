import { describe, expect, it } from "vitest";
import type { AvatarAppearance } from "@hellovalley/shared";
import { setAnimal } from "../onboarding/draft";
import { appearanceFromDraft, draftFromAppearance, isDirty } from "./mirrorDraft";

const saved: AvatarAppearance = { animal: "fox", colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { h: 120, s: 0.5, l: 0.75 } } };

describe("mirror draft", () => {
  it("round-trips the saved appearance and starts clean", () => {
    const d = draftFromAppearance(saved);
    expect(appearanceFromDraft(d)).toEqual(saved);
    expect(isDirty(saved, d)).toBe(false);
  });

  it("is dirty after a colour, fur or animal change", () => {
    const d = draftFromAppearance(saved);
    expect(isDirty(saved, { ...d, shirt: { swatch: "mint" } })).toBe(true);
    expect(isDirty(saved, { ...d, fur: "arctic" })).toBe(true);
    const rabbit = setAnimal(d, "rabbit");
    expect(rabbit.fur).toBe("snow");
    expect(isDirty(saved, rabbit)).toBe(true);
    expect(appearanceFromDraft(rabbit)?.animal).toBe("rabbit");
  });

  it("clamps custom colours and rejects a fur of another animal", () => {
    const d = draftFromAppearance(saved);
    expect(appearanceFromDraft({ ...d, shirt: { h: 10, s: 2, l: 0 } })?.colors.shirt).toEqual({ h: 10, s: 0.7, l: 0.6 });
    expect(appearanceFromDraft({ ...d, fur: "snow" })).toBeNull();
    expect(isDirty(saved, { ...d, fur: "snow" })).toBe(false);
  });
});
