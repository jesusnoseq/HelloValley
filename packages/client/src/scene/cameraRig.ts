/**
 * Shared per-frame camera state (no React, no shared-package imports). The player controller
 * writes `follow` (the point the camera should track) and sets `snap` to jump there without
 * easing (after a door fade); IsoCamera eases towards it and publishes the eased `target` and
 * `yaw`, which the lights, the cut-away walls and the WASD mapping read.
 */
export type Vec3 = [number, number, number];

export interface CameraRig {
  /** Point to follow, or null to use the view's fixed target. */
  follow: Vec3 | null;
  /** Jump to `follow` on the next frame instead of easing. */
  snap: boolean;
  /** Eased look-at point this frame. */
  target: Vec3;
  /** Eased camera yaw this frame (radians, see cameraMath.yawForStep). */
  yaw: number;
  /**
   * While talking to an NPC (build plan M23, GDD §8.1 "the camera eases in"): look at the pair's
   * midpoint and zoom in to this view height. Null otherwise.
   */
  talk: { target: Vec3; viewHeight: number } | null;
}

export const cameraRig: CameraRig = { follow: null, snap: false, target: [0, 0, 0], yaw: Math.PI / 4, talk: null };

/** View height (metres) of the conversation close-up, a little closer than the nearest zoom level. */
export const TALK_VIEW_HEIGHT = 7.5;

/** Easing rate (1/s) of the camera following the player. */
export const FOLLOW_DAMPING = 6;

/** Grid the key light's target snaps to, so its shadows do not shimmer as the camera glides. */
export const SHADOW_SNAP_M = 1;

export function snapToGrid(v: number, step = SHADOW_SNAP_M): number {
  return Math.round(v / step) * step;
}
