/**
 * Free-standing modules the town places (GDD §4.1): which kit they come from and how they affect
 * walking. Rects are in the module frame (metres, pivot at the front-left corner, the module
 * covering x in [0, w] and z in [-d, 0]) as [x0, z0, x1, z1]. A test checks each blocker against
 * the committed kit manifests, so shared code needs no manifest at run time (the server builds the
 * same walkability grid).
 */

export type Rect = [number, number, number, number];

/** `style`: from the player's style kit (it swaps with the style); `common`: the style-neutral kit. */
export type PropKit = "style" | "common";

export interface TownPropDef {
  kit: PropKit;
  /** Footprint in 1 m cells. */
  w: number;
  d: number;
  /** Area that blocks walking; omitted for pieces you can walk over or under. */
  blocks?: Rect;
  /** Deck you walk on even over water (bridge, dock). */
  walk?: Rect;
  /** The blocker covers the manifest bounds (solid props). Trees block only at the trunk. */
  solid?: boolean;
}

export const TOWN_PROPS = {
  // Style-kit street furniture (the recipe props of M10 plus square furniture).
  bench: { kit: "style", w: 2, d: 1, blocks: [0.1, -0.85, 1.9, -0.25], solid: true },
  lamp: { kit: "style", w: 1, d: 1, blocks: [0.3, -0.7, 0.7, -0.3] },
  fence: { kit: "style", w: 1, d: 1, blocks: [0, -0.15, 1, 0], solid: true },
  stair: { kit: "style", w: 1, d: 1, blocks: [0, -1, 1, 0], solid: true },
  // Common kit (M06).
  fountain: { kit: "common", w: 2, d: 2, blocks: [0.05, -1.96, 1.96, -0.04], solid: true },
  notice_board: { kit: "common", w: 2, d: 1, blocks: [0.09, -0.81, 1.91, -0.19], solid: true },
  market_stall: { kit: "common", w: 2, d: 2, blocks: [0.04, -1.96, 1.96, -0.04], solid: true },
  crate: { kit: "common", w: 1, d: 1, blocks: [0.15, -0.85, 0.85, -0.15], solid: true },
  barrel: { kit: "common", w: 1, d: 1, blocks: [0.14, -0.82, 0.86, -0.18], solid: true },
  basket: { kit: "common", w: 1, d: 1, blocks: [0.23, -0.78, 0.77, -0.22], solid: true },
  rock: { kit: "common", w: 1, d: 1, blocks: [0.05, -0.9, 0.93, -0.13], solid: true },
  bush: { kit: "common", w: 1, d: 1, blocks: [0.08, -0.91, 0.9, -0.09], solid: true },
  flowers: { kit: "common", w: 1, d: 1, blocks: [0, -1, 1, 0], solid: true },
  "tree.deciduous": { kit: "common", w: 2, d: 2, blocks: [0.7, -1.3, 1.3, -0.7] },
  "tree.conifer": { kit: "common", w: 2, d: 2, blocks: [0.7, -1.3, 1.3, -0.7] },
  "tree.cypress": { kit: "common", w: 1, d: 1, blocks: [0.3, -0.7, 0.7, -0.3] },
  "bridge.stone": { kit: "common", w: 2, d: 4, walk: [0.4, -4, 1.6, 0] },
  "dock.fishing": { kit: "common", w: 2, d: 3, walk: [0.4, -3, 1.6, -0.2] },
} as const satisfies Record<string, TownPropDef>;

export type TownPropModuleId = keyof typeof TOWN_PROPS;

export function townPropDef(id: TownPropModuleId): TownPropDef {
  return TOWN_PROPS[id];
}
