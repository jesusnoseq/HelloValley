import { describe, expect, it } from "vitest";
import { groundIndex, type GroundMap } from "./terrain";
import { TOWN_D, TOWN_W, townPlaces } from "./town";
import { encodeShoreField, sampleShore, SHORE_FIELD_CELL, shoreField, townShoreField } from "./water";
import { townRenderPlan } from "./render";

/** A 20 x 10 map with water in z = [4, 7) across the whole width. */
function stripe(): GroundMap {
  const w = 20;
  const d = 10;
  const cells = new Uint8Array(w * d);
  for (let z = 4; z < 7; z++) for (let x = 0; x < w; x++) cells[z * w + x] = groundIndex("water");
  return { w, d, cells };
}

describe("shore field", () => {
  it("is the signed distance to the water cells' border", () => {
    const f = shoreField(stripe(), { cell: 0.5, landRange: 2, waterRange: 4 });
    expect(f.w).toBe(40);
    expect(f.d).toBe(20);
    // Sample points 1.25 m from the nearer bank (the middle of the 3 m stripe is between samples).
    expect(sampleShore(f, 10, 5.25)).toBeCloseTo(1.25, 5);
    expect(sampleShore(f, 10, 5.5)).toBeGreaterThan(1.2);
    // Just inside and outside the north bank at z = 4.
    expect(sampleShore(f, 10, 4.25)).toBeCloseTo(0.25, 1);
    expect(sampleShore(f, 10, 3.75)).toBeCloseTo(-0.25, 1);
    // Far on land: clamped to the land range.
    expect(sampleShore(f, 10, 0.25)).toBeCloseTo(-2, 5);
    // The river runs off the map at full depth: no shore along the map edge.
    expect(sampleShore(f, 0.25, 5.25)).toBeCloseTo(1.25, 5);
  });

  it("encodes the clamped range into bytes", () => {
    const f = shoreField(stripe(), { cell: 0.5, landRange: 2, waterRange: 4 });
    const bytes = encodeShoreField(f);
    expect(bytes.length).toBe(f.w * f.d);
    expect(Math.min(...bytes)).toBe(0);
    // The shore (distance 0) sits at 2 / 6 of the range.
    const zero = Math.round((2 / 6) * 255);
    const nearShore = bytes[Math.floor(4.25 / 0.5) * f.w + 20]!;
    expect(Math.abs(nearShore - zero)).toBeLessThan(15);
  });

  it("covers the town river", () => {
    const f = townShoreField();
    expect(f.cell).toBe(SHORE_FIELD_CELL);
    expect(f.w * f.cell).toBe(TOWN_W);
    expect(f.d * f.cell).toBe(TOWN_D);
    // Every water tile of the render plan is over water; the river is about 5 m wide.
    const water = townRenderPlan().flats.filter((t) => t.ground === "water");
    expect(water.length).toBeGreaterThan(0);
    for (const t of water) expect(sampleShore(f, t.x + 0.5, t.z + 0.5)).toBeGreaterThan(0);
    const deepest = Math.max(...f.data);
    expect(deepest).toBeGreaterThan(2);
    expect(deepest).toBeLessThanOrEqual(f.waterRange);
    // The town square and its fountain are far from the river.
    const [sx, sz] = townPlaces().fountain;
    expect(sampleShore(f, sx, sz)).toBe(-f.landRange);
  });
});
