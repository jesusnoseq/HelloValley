import { describe, expect, it } from "vitest";
import { parseProfileDoc } from "./parseProfile";

const stored = {
  name: "Lia",
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "mint" }, trousers: { h: 10, s: 0.5, l: 0.7 } },
  apartmentId: "6D",
  nativeLang: "es",
  targetLangs: ["ja"],
  style: "japanese",
  createdAt: { seconds: 1_790_000_000, nanoseconds: 0 },
};

describe("parseProfileDoc", () => {
  it("returns null for a missing profile (onboarding not done)", () => {
    expect(parseProfileDoc(null)).toBeNull();
    expect(parseProfileDoc(undefined)).toBeNull();
  });

  it("drops createdAt from a stored profile", () => {
    const { createdAt: _c, ...rest } = stored;
    expect(parseProfileDoc(stored)).toEqual(rest);
  });

  it("throws on a corrupt profile", () => {
    expect(() => parseProfileDoc({ ...stored, apartmentId: "Z9" })).toThrow();
    expect(() => parseProfileDoc({ ...stored, colors: { ...stored.colors, fur: "leaf" } })).toThrow();
  });
});
