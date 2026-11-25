import type { Motion, SpaceId } from "@hellovalley/shared";

/**
 * Snapshot interpolation for remote avatars (build plan M16). Every state patch that changes a
 * remote player is stored with its arrival time; the avatar is drawn INTERP_DELAY_MS in the past,
 * between the two snapshots around that moment, so 20 Hz updates with network jitter look like a
 * smooth walk. Teleports (a space change or a jump longer than SNAP_DISTANCE_M) cut instead of
 * gliding. Pure (no three.js): tested in Node.
 */

export interface RemoteSample {
  space: SpaceId;
  x: number;
  z: number;
  heading: number;
  motion: Motion;
}

/** How far in the past remote avatars are drawn: a bit more than two patch intervals. */
export const INTERP_DELAY_MS = 120;
/** Snapshots older than this (behind the newest) are dropped. */
export const INTERP_BUFFER_MS = 1000;
/** A jump longer than this between two snapshots is drawn as a cut. */
export const SNAP_DISTANCE_M = 3;
/** A snapshot after a pause this long starts a new movement from rest (see `push`). */
export const RESUME_GAP_MS = 250;
/** Normal spacing of snapshots while a player moves (the server's patch interval). */
export const NOMINAL_INTERVAL_MS = 50;

function lerpAngle(a: number, b: number, f: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * f;
}

export class RemoteTrack {
  private buf: { t: number; s: RemoteSample }[] = [];

  /** Adds a snapshot that arrived at `t` (ms, monotonic clock). */
  push(t: number, s: RemoteSample): void {
    const last = this.buf.at(-1);
    if (last && t < last.t) t = last.t;
    // After a pause, hold the old pose until just before the new snapshot, so the avatar does not
    // crawl across the whole pause towards it.
    if (last && t - last.t > RESUME_GAP_MS) this.buf.push({ t: t - NOMINAL_INTERVAL_MS, s: last.s });
    this.buf.push({ t, s: { ...s } });
    const keepFrom = t - INTERP_BUFFER_MS;
    while (this.buf.length > 2 && this.buf[1]!.t < keepFrom) this.buf.shift();
  }

  get size(): number {
    return this.buf.length;
  }

  /** The newest snapshot (the server's latest word), or null. */
  get latest(): RemoteSample | null {
    return this.buf.at(-1)?.s ?? null;
  }

  /** The pose to draw at render time `t` (usually now − INTERP_DELAY_MS), or null when empty. */
  sampleAt(t: number): RemoteSample | null {
    const buf = this.buf;
    if (buf.length === 0) return null;
    if (t <= buf[0]!.t) return { ...buf[0]!.s };
    const last = buf.at(-1)!;
    if (t >= last.t) return { ...last.s };
    let k = 0;
    while (buf[k + 1]!.t <= t) k++;
    const a = buf[k]!;
    const b = buf[k + 1]!;
    const gap = Math.hypot(b.s.x - a.s.x, b.s.z - a.s.z);
    if (a.s.space !== b.s.space || gap > SNAP_DISTANCE_M) return { ...a.s };
    const f = (t - a.t) / (b.t - a.t);
    // Still travelling towards a stop: keep the gait until the stop is reached.
    const motion = b.s.motion !== "idle" ? b.s.motion : a.s.motion !== "idle" && gap > 1e-3 ? a.s.motion : b.s.motion;
    return {
      space: b.s.space,
      x: a.s.x + (b.s.x - a.s.x) * f,
      z: a.s.z + (b.s.z - a.s.z) * f,
      heading: lerpAngle(a.s.heading, b.s.heading, f),
      motion,
    };
  }
}
