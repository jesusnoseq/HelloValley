/**
 * Camera framing of the town. No value imports from shared here: App (the entry chunk) uses it,
 * and shared would pull zod in. A test keeps the numbers equal to the shared layout.
 */

/**
 * Camera target before the player controller takes over (scene/Player sets `cameraRig.follow`):
 * the spawn point in front of the apartment block door (shared SPAWN_POINT).
 */
export const SPAWN_TARGET: [number, number, number] = [33, 0, 88.5];
/** Shadow camera half-size that covers the far zoom around the target. */
export const TOWN_SHADOW_EXTENT = 36;
/** View height that fits the whole 64 x 100 m town on screen at any of the four facings (dev overview). */
export const OVERVIEW_VIEW_HEIGHT = 92;
export const OVERVIEW_SHADOW_EXTENT = 62;
