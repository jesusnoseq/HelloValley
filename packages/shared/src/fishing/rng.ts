/**
 * A small seeded random number generator (build plan M27): the server rolls every cast with it,
 * so a test (or a replay) with the same seed gets the same fish, bite delay and reel zone.
 * mulberry32 over a 32-bit seed; `seedFrom` hashes any parts (FNV-1a) into one. Not for secrets:
 * the server mixes a per-process random value into the seed so clients cannot predict a cast.
 */

export type Rng = () => number;

/** A generator of floats in [0, 1) from a 32-bit seed. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit seed from strings and numbers (FNV-1a over their JSON). */
export function seedFrom(...parts: readonly (string | number)[]): number {
  const text = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Picks a weighted entry; null for an empty table (or one whose weights are all 0). */
export function pickWeighted<T>(entries: readonly { value: T; weight: number }[], rng: Rng): T | null {
  const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
  if (!(total > 0)) return null;
  let r = rng() * total;
  for (const e of entries) {
    r -= Math.max(0, e.weight);
    if (r < 0) return e.value;
  }
  return entries.at(-1)!.value;
}
