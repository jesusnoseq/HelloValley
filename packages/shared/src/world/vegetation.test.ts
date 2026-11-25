import { describe, expect, it } from "vitest";
import { townBlockers } from "./navgrid";
import { townRenderPlan } from "./render";
import { groundAt } from "./terrain";
import { townGround } from "./town";
import { GRASS_TUFT_CLEARANCE, GRASS_TUFT_VARIANTS, grassTufts, isPlantModule, townGrassTufts } from "./vegetation";

describe("vegetation", () => {
  it("knows which modules sway", () => {
    expect(isPlantModule("tree.deciduous")).toBe(true);
    expect(isPlantModule("bush")).toBe(true);
    expect(isPlantModule("flowers")).toBe(true);
    expect(isPlantModule("rock")).toBe(false);
    expect(isPlantModule("terrain.grass")).toBe(false);
    expect(townRenderPlan().modules.filter((m) => isPlantModule(m.module)).length).toBeGreaterThan(30);
  });

  it("grows grass clusters on open grass, clear of blockers", () => {
    const tufts = townGrassTufts();
    const ground = townGround();
    const blockers = townBlockers();
    // Enough to read as a meadow, few enough for the triangle budget.
    expect(tufts.length).toBeGreaterThan(120);
    expect(tufts.length).toBeLessThan(600);
    for (const t of tufts) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(groundAt(ground, t.x + dx * 0.9, t.z + dz * 0.9)).toBe("grass");
      for (const b of blockers) {
        const inside = t.x > b.area[0] - GRASS_TUFT_CLEARANCE && t.x < b.area[2] + GRASS_TUFT_CLEARANCE && t.z > b.area[1] - GRASS_TUFT_CLEARANCE && t.z < b.area[3] + GRASS_TUFT_CLEARANCE;
        expect(inside, `${t.x}, ${t.z} in ${b.source}`).toBe(false);
      }
      expect(t.variant).toBeGreaterThanOrEqual(0);
      expect(t.variant).toBeLessThan(GRASS_TUFT_VARIANTS);
      expect(t.scale).toBeGreaterThanOrEqual(0.8);
      expect(t.scale).toBeLessThanOrEqual(1.2);
    }
    // Every look shows up; the blooming ones are rarer.
    const counts = Array.from({ length: GRASS_TUFT_VARIANTS }, (_, v) => tufts.filter((t) => t.variant === v).length);
    expect(counts.every((c) => c > 0)).toBe(true);
    expect(counts[0]! + counts[1]!).toBeGreaterThan(counts[2]! + counts[3]!);
  });

  it("is deterministic and scales with the share", () => {
    const ground = townGround();
    const a = grassTufts(ground, [], 0.05);
    expect(grassTufts(ground, [], 0.05)).toEqual(a);
    expect(grassTufts(ground, [], 0.1).length).toBeGreaterThan(a.length);
    expect(grassTufts(ground, [], 0)).toEqual([]);
  });
});
