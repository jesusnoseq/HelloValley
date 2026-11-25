import type { Motion, MoveCorrectionMessage, PlayerMoveMessage, SpaceId, SpacePoint } from "@hellovalley/shared";

/**
 * Local prediction and reconciliation for the player's walker (build plan M16). The client moves
 * its own PlayerController at once (no waiting for the server) and reports where it is; the
 * TownRoom validates every report. When it rejects one it sends a correction with a new epoch:
 * the client snaps back to the server's point and from then on only reports in that epoch, so
 * reports already in flight from the wrong path are ignored instead of causing more corrections.
 */

/** Shortest gap between two reports while moving (matches the server's 20 Hz patch rate). */
export const MOVE_SEND_INTERVAL_MS = 50;
/** Changes below these thresholds are not worth a report. */
export const MOVE_POS_EPS_M = 0.005;
export const MOVE_HEADING_EPS = 0.02;

interface Reported {
  space: SpaceId;
  x: number;
  z: number;
  heading: number;
  motion: Motion;
}

export interface WalkerState {
  space: SpaceId;
  pos: readonly [number, number];
  heading: number;
  motion: Motion;
}

export class MoveSync {
  epoch = 0;
  private seq = 0;
  private last: Reported | null = null;
  private lastAt = Number.NEGATIVE_INFINITY;

  /**
   * The report to send now, or null. Moving reports go out at most every MOVE_SEND_INTERVAL_MS;
   * the first one, stopping, a space change and `force` (walking into a door) go out at once.
   */
  next(state: WalkerState, nowMs: number, force = false): PlayerMoveMessage | null {
    const last = this.last;
    const changed =
      !last ||
      last.space !== state.space ||
      last.motion !== state.motion ||
      Math.hypot(state.pos[0] - last.x, state.pos[1] - last.z) > MOVE_POS_EPS_M ||
      Math.abs(state.heading - last.heading) > MOVE_HEADING_EPS;
    if (!changed && !force) return null;
    const urgent = force || !last || last.space !== state.space || (state.motion === "idle" && last.motion !== "idle");
    if (!urgent && nowMs - this.lastAt < MOVE_SEND_INTERVAL_MS) return null;
    this.last = { space: state.space, x: state.pos[0], z: state.pos[1], heading: state.heading, motion: state.motion };
    this.lastAt = nowMs;
    return { seq: ++this.seq, epoch: this.epoch, ...this.last };
  }

  /** Applies a server correction. Returns where to put the walker, or null for a stale one. */
  correct(c: MoveCorrectionMessage): SpacePoint | null {
    if (c.epoch <= this.epoch) return null;
    this.epoch = c.epoch;
    this.last = { space: c.space, x: c.x, z: c.z, heading: c.heading, motion: "idle" };
    this.lastAt = Number.NEGATIVE_INFINITY;
    return { space: c.space, pos: [c.x, c.z], heading: c.heading };
  }

  /** A new session (fresh join): epochs and sequence numbers start over. */
  reset(): void {
    this.epoch = 0;
    this.seq = 0;
    this.last = null;
    this.lastAt = Number.NEGATIVE_INFINITY;
  }
}
