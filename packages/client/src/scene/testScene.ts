/**
 * Deterministic layout for the M09 placeholder scene: pastel blocks with roofs, cloud trees and
 * street lamps on a square diorama base. Pure data so it can be tested; the real town replaces it
 * in TODO(M11).
 */

export const TEST_BASE_SIZE = 30;
const LOT = 4;
/** Placeholder storey height: squatter than the 3 m kit storey so the blocks read as cottages. */
const STOREY = 2.4;
/** Half the width of the road cross in metres: the middle row and column of lots. */
export const TEST_ROAD_HALF_WIDTH = LOT / 2;
/** Lamps stand on the verge, this far from the middle of each road. */
const LAMP_OFFSET = TEST_ROAD_HALF_WIDTH + 0.1;

const WALLS = ["#f6efdc", "#f8e3a1", "#f7c6a3", "#f2b8c6", "#d9c2e6", "#aed6ef", "#b5e5cf", "#b9cba5"];
const ROOFS = ["#b5584a", "#a8463f", "#6f7a8c", "#5d6878", "#c27a56"];
const CANOPIES = ["#8fbf73", "#7fb069", "#a3c97f", "#6fa565"];

export interface Block {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  wall: string;
  roof: string;
  roofHeight: number;
}

export interface Tree {
  x: number;
  z: number;
  scale: number;
  canopy: string;
}

export interface Lamp {
  x: number;
  z: number;
}

export interface TestLayout {
  blocks: Block[];
  trees: Tree[];
  lamps: Lamp[];
}

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function testSceneLayout(seed = 9): TestLayout {
  const rand = seededRandom(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const blocks: Block[] = [];
  const trees: Tree[] = [];
  const lamps: Lamp[] = [];
  const half = TEST_BASE_SIZE / 2;
  const lots = Math.floor((TEST_BASE_SIZE - 2) / LOT);
  const origin = -(lots * LOT) / 2;

  for (let i = 0; i < lots; i++) {
    for (let j = 0; j < lots; j++) {
      const cx = origin + (i + 0.5) * LOT;
      const cz = origin + (j + 0.5) * LOT;
      // Leave the road cross (the middle row and column of lots) clear.
      if (Math.abs(cx) < TEST_ROAD_HALF_WIDTH || Math.abs(cz) < TEST_ROAD_HALF_WIDTH) continue;
      const roll = rand();
      if (roll < 0.62) {
        const width = 2 + Math.round(rand() * 2) * 0.5;
        const depth = 2 + Math.round(rand() * 2) * 0.5;
        const storeys = 1 + Math.floor(rand() * 2);
        blocks.push({ x: cx, z: cz, width, depth, height: storeys * STOREY, wall: pick(WALLS), roof: pick(ROOFS), roofHeight: 1.2 + rand() * 0.8 });
      } else {
        const count = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < count; k++) {
          trees.push({ x: cx + (rand() - 0.5) * 2.4, z: cz + (rand() - 0.5) * 2.4, scale: 0.8 + rand() * 0.5, canopy: pick(CANOPIES) });
        }
      }
    }
  }

  // Lamps along both roads, on alternating sides.
  for (let p = -half + 3; p <= half - 3; p += 5) {
    if (Math.abs(p) < 2) continue;
    const side = p % 2 === 0 ? 1 : -1;
    lamps.push({ x: p, z: side * LAMP_OFFSET }, { x: -side * LAMP_OFFSET, z: p });
  }
  return { blocks, trees, lamps };
}
