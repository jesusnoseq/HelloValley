/** Deterministic hash of a cell to [0, 1). */
export function cellHash(x: number, z: number, salt = 0): number {
  let h = (Math.imul(Math.floor(x * 2) + 7919, 73856093) ^ Math.imul(Math.floor(z * 2) + 104729, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
