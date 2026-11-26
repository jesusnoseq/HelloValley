import { STYLE_IDS, type StyleId } from "../data/styles";
import { cellHash } from "./hash";
import { type Rect, TOWN_PROPS, type TownPropModuleId } from "./props";
import type { TownProp } from "./town";

/**
 * Per-style town dressing (build plan M34; M32/M33 extras): the town layout is the same for every
 * player, but some of its props look different in each style. Two data-driven mechanisms, both
 * leaving building recipes untouched:
 *
 * - **Swaps**: per style, a neutral prop module maps to one or more styled modules; each placement
 *   picks one from its position (deterministic), so a Japanese town grows cherries and maples where
 *   the European one has broadleaf trees, and crosses the river on a wooden bridge.
 * - **Decoration spots**: layout entries limited to some styles (`TownProp.styles`), such as the
 *   Mediterranean pergola or the Arabic arcade, and spots whose neutral module every style swaps
 *   (the lantern spots: a bush in Europe, a stone lantern in Japan, a brass one in the Arabic town).
 *
 * Walking stays identical for everyone (the server builds one walkability grid without knowing any
 * style): a placement blocks the union of what all its fills block (navgrid.ts), and a swap keeps
 * the neutral's footprint and deck (tests check the kits). The client renders each placement with
 * `dressTownProp` for the player's style (render.ts).
 */

export interface StyleDressing {
  /** Neutral module → the modules this style shows instead (one is picked per placement). */
  swaps: Readonly<Partial<Record<TownPropModuleId, readonly TownPropModuleId[]>>>;
}

export const STYLE_TOWN_DRESSING: Readonly<Record<StyleId, StyleDressing>> = {
  european: {
    swaps: { "lantern.stone": ["bush"] },
  },
  mediterranean: {
    swaps: {
      "tree.deciduous": ["tree.olive", "tree.lemon", "tree.deciduous"],
      "lantern.stone": ["pot.terracotta"],
    },
  },
  arabic: {
    swaps: {
      fountain: ["fountain.courtyard"],
      "tree.deciduous": ["tree.date_palm", "tree.palm"],
      "lantern.stone": ["lantern.brass"],
    },
  },
  japanese: {
    swaps: {
      "tree.deciduous": ["tree.sakura", "tree.maple"],
      "tree.conifer": ["tree.pine", "tree.conifer"],
      "bridge.stone": ["bridge.wooden"],
    },
  },
};

/**
 * The module a layout prop shows in a style, or null when the prop is a decoration of other
 * styles only.
 */
export function dressTownProp(prop: Pick<TownProp, "module" | "at" | "styles">, style: StyleId): TownPropModuleId | null {
  if (prop.styles && !prop.styles.includes(style)) return null;
  const options = STYLE_TOWN_DRESSING[style].swaps[prop.module];
  if (!options || options.length === 0) return prop.module;
  return options[Math.floor(cellHash(prop.at[0], prop.at[1], 97) * options.length)]!;
}

/** Every module a layout prop shows in some style (its fills), without repeats. */
export function townPropFills(prop: Pick<TownProp, "module" | "at" | "styles">): TownPropModuleId[] {
  const out: TownPropModuleId[] = [];
  for (const style of STYLE_IDS) {
    const m = dressTownProp(prop, style);
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/** True when a prop does not look the same in every style (the client rebuilds it on a switch). */
export function isDressedProp(prop: Pick<TownProp, "module" | "at" | "styles">): boolean {
  return prop.styles !== undefined || townPropFills(prop).some((m) => m !== prop.module);
}

/** The module-frame walking blockers of a prop: one per fill that blocks (navgrid.ts). */
export function townPropBlocks(prop: Pick<TownProp, "module" | "at" | "styles">): Rect[] {
  const out: Rect[] = [];
  for (const m of townPropFills(prop)) {
    const blocks = (TOWN_PROPS[m] as { blocks?: Rect }).blocks;
    if (blocks && !out.some((r) => r.every((v, i) => v === blocks[i]))) out.push(blocks);
  }
  return out;
}
