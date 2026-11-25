import { describe, expect, it } from "vitest";
import { NAME_TAG, nameTagLayout } from "./nameTag";

describe("name tag layout", () => {
  it("fits the text plus padding, supersampled", () => {
    const l = nameTagLayout(100);
    expect(l.canvas).toEqual([(100 + NAME_TAG.padX * 2) * NAME_TAG.supersample, NAME_TAG.heightPx * NAME_TAG.supersample]);
    expect(l.world[0]).toBeCloseTo((100 + NAME_TAG.padX * 2) * NAME_TAG.metresPerPx);
    expect(l.world[1]).toBeCloseTo(NAME_TAG.heightPx * NAME_TAG.metresPerPx);
  });

  it("is never narrower than a circle nor wider than the cap", () => {
    expect(nameTagLayout(0).canvas[0]).toBe(NAME_TAG.heightPx * NAME_TAG.supersample);
    expect(nameTagLayout(Number.NaN).canvas[0]).toBe(NAME_TAG.heightPx * NAME_TAG.supersample);
    expect(nameTagLayout(10_000).canvas[0]).toBe(NAME_TAG.maxWidthPx * NAME_TAG.supersample);
  });

  it("stays small next to a 1.2 m character", () => {
    const widest = nameTagLayout(10_000).world;
    expect(widest[0]).toBeLessThan(2.5);
    expect(widest[1]).toBeLessThan(0.4);
  });
});
