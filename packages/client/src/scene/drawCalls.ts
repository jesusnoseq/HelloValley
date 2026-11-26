/**
 * Draw-call estimate for a diorama scene (GDD §7.2: the whole town under 150 draw calls). The
 * browser's `renderer.info` (the dev perf HUD) is the real number; this is an upper bound that a
 * unit test can check without WebGL:
 * - main pass: every mesh, as if all were in view (the overview);
 * - shadow pass: every shadow caster, as if all were inside the key light's shadow camera;
 * - post-processing: a fixed number of full-screen passes.
 * Instanced and batched meshes count once per pass (BatchedMesh uses WEBGL_multi_draw, which
 * desktop Chrome supports; without it three falls back to one call per instance).
 */

export interface DrawItem {
  label: string;
  castShadow: boolean;
}

/**
 * Draws of the DioramaEffects stack (scene/DioramaEffects.tsx: N8AO at half resolution, mipmap
 * bloom, tilt-shift, tone mapping), measured in M12 with the town overview in headless Chrome:
 * 123 calls with effects, 88 without (which matches main + shadow here exactly), so 35, plus one
 * spare.
 */
export const POST_PROCESSING_DRAWS = 36;

export const DRAW_CALL_BUDGET = 150;

/** GDD §7.2: under 300k triangles on screen. */
export const TRIANGLE_BUDGET = 300_000;

/**
 * M37 headroom: the whole town (every style, everything in view, the local player included) stays
 * at least 5 % under the triangle budget and leaves 35 draw calls for characters (scene/crowdPlan.ts).
 */
export const TOWN_TRIANGLES_WITH_HEADROOM = TRIANGLE_BUDGET * 0.95;
export const TOWN_DRAW_CALLS_WITH_HEADROOM = 112;

export interface DrawCallEstimate {
  main: number;
  shadow: number;
  post: number;
  total: number;
}

export function estimateDrawCalls(items: readonly DrawItem[], options: { shadows?: boolean; post?: boolean } = {}): DrawCallEstimate {
  const main = items.length;
  const shadow = options.shadows === false ? 0 : items.filter((i) => i.castShadow).length;
  const post = options.post === false ? 0 : POST_PROCESSING_DRAWS;
  return { main, shadow, post, total: main + shadow + post };
}
