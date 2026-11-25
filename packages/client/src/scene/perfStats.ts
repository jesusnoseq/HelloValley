/** Pure helpers for the dev perf HUD (fps, draw calls, triangles). */

/** Averages frame times over a window and reports frames per second once per window. */
export class FpsMeter {
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  constructor(private readonly window = 0.5) {}

  /** Feeds one frame of `dt` seconds. Returns the average fps and worst frame (ms) per window. */
  tick(dt: number): { fps: number; worstMs: number } | undefined {
    if (!(dt > 0)) return undefined;
    this.frames++;
    this.elapsed += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.elapsed < this.window) return undefined;
    const result = { fps: this.frames / this.elapsed, worstMs: this.worst * 1000 };
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    return result;
  }
}

/** Compact count for the HUD: 950, 12.3k, 1.20M. */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Device pixel ratio for a quality factor 0–1 (drei's PerformanceMonitor lowers the factor when
 * frames drop), clamped to the screen's own ratio. Steps of 0.25 avoid constant canvas resizes.
 */
export function dprForFactor(factor: number, deviceRatio: number, min = 1, max = 1.5): number {
  const f = Math.min(1, Math.max(0, factor));
  const raw = min + (max - min) * f;
  const stepped = Math.round(raw * 4) / 4;
  return Math.max(Math.min(min, deviceRatio), Math.min(stepped, deviceRatio));
}
