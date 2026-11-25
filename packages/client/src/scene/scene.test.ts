import { describe, expect, it } from "vitest";
import { createDioramaStore } from "../state/dioramaStore";
import { DEFAULT_ZOOM_LEVEL, ZOOM_LEVELS } from "./cameraMath";
import { dprForFactor, formatCount, FpsMeter } from "./perfStats";
import { seededRandom, TEST_BASE_SIZE, TEST_ROAD_HALF_WIDTH, testSceneLayout } from "./testScene";

describe("FpsMeter", () => {
  it("reports the average fps and worst frame once per window", () => {
    const m = new FpsMeter(0.5);
    for (let i = 0; i < 29; i++) expect(m.tick(1 / 60)).toBeUndefined();
    const result = m.tick(1 / 60 + 0.001);
    expect(result!.fps).toBeCloseTo(30 / (0.5 + 0.001), 3);
    expect(result!.worstMs).toBeCloseTo(1000 / 60 + 1, 3);
    // The next window starts empty.
    expect(m.tick(1 / 60)).toBeUndefined();
    expect(m.tick(0)).toBeUndefined();
  });
});

describe("formatCount", () => {
  it("abbreviates large counts", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1234)).toBe("1.23k");
    expect(formatCount(45_600)).toBe("45.6k");
    expect(formatCount(1_200_000)).toBe("1.20M");
  });
});

describe("dprForFactor", () => {
  it("scales between 1 and 1.5 in quarter steps, capped by the screen", () => {
    expect(dprForFactor(1, 2)).toBe(1.5);
    expect(dprForFactor(0, 2)).toBe(1);
    expect(dprForFactor(0.5, 2)).toBe(1.25);
    expect(dprForFactor(1, 1)).toBe(1);
    expect(dprForFactor(1, 1.25)).toBe(1.25);
    expect(dprForFactor(5, 3)).toBe(1.5);
  });
});

describe("dioramaStore", () => {
  it("rotates in unwrapped steps and clamps zoom", () => {
    const store = createDioramaStore();
    const s = () => store.getState();
    expect(s().zoomLevel).toBe(DEFAULT_ZOOM_LEVEL);
    s().rotate(-1);
    s().rotate(-1);
    expect(s().cameraStep).toBe(-2);
    for (let i = 0; i < 5; i++) s().zoom(1);
    expect(s().zoomLevel).toBe(ZOOM_LEVELS.length - 1);
    for (let i = 0; i < 5; i++) s().zoom(-1);
    expect(s().zoomLevel).toBe(0);
  });

  it("wraps worldTime and keeps timeScale non-negative", () => {
    const store = createDioramaStore({ worldTime: 1.5 });
    expect(store.getState().worldTime).toBeCloseTo(0.5);
    store.getState().setWorldTime(-0.1);
    expect(store.getState().worldTime).toBeCloseTo(0.9);
    store.getState().setTimeScale(-3);
    expect(store.getState().timeScale).toBe(0);
  });
});

describe("test scene layout", () => {
  it("is deterministic", () => {
    expect(testSceneLayout(3)).toEqual(testSceneLayout(3));
    const a = seededRandom(1);
    const b = seededRandom(1);
    for (let i = 0; i < 10; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("keeps blocks on the base, off the roads and apart", () => {
    const { blocks, trees, lamps } = testSceneLayout();
    expect(blocks.length).toBeGreaterThan(10);
    expect(trees.length).toBeGreaterThan(3);
    expect(lamps.length).toBeGreaterThan(3);
    const half = TEST_BASE_SIZE / 2;
    for (const b of blocks) {
      expect(Math.abs(b.x) + b.width / 2).toBeLessThan(half);
      expect(Math.abs(b.z) + b.depth / 2).toBeLessThan(half);
      expect(Math.abs(b.x) - b.width / 2).toBeGreaterThanOrEqual(TEST_ROAD_HALF_WIDTH);
      expect(Math.abs(b.z) - b.depth / 2).toBeGreaterThanOrEqual(TEST_ROAD_HALF_WIDTH);
    }
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i]!;
        const c = blocks[j]!;
        const apart = Math.abs(a.x - c.x) >= (a.width + c.width) / 2 || Math.abs(a.z - c.z) >= (a.depth + c.depth) / 2;
        expect(apart).toBe(true);
      }
    }
    for (const l of [...lamps, ...trees]) {
      expect(Math.abs(l.x)).toBeLessThan(half);
      expect(Math.abs(l.z)).toBeLessThan(half);
    }
  });
});
