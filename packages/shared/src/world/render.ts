import type { Vec3 } from "../buildings/assemble";
import { type PropKit, TOWN_PROPS, type TownPropModuleId } from "./props";
import { type FeatureGround, type Ground, TERRAIN_TOP, TERRAIN_Y, terrainModuleId, tileTerrain } from "./terrain";
import { buildingArea, TOWN_BUILDINGS, TOWN_PROPS_LAYOUT, townGround } from "./town";

/**
 * What the client draws for the town apart from the buildings: one entry per kit module instance
 * plus the flat ground tiles. Pure data so its triangle and draw-call budget can be tested against
 * the kit manifests (GDD §7.2: the whole town under 300k triangles and 150 draw calls).
 */

export interface TownModulePlacement {
  kit: PropKit;
  module: string;
  variant: number;
  /** Module pivot in the town frame (y included) and quarter turns about +Y. */
  position: Vec3;
  rot: number;
}

/** A 1 x 1 m flat tile at height `y` (the top of its ground): x in [x, x + 1], z in [z, z + 1]. */
export interface FlatTile {
  ground: Ground;
  x: number;
  z: number;
  y: number;
}

export interface TownRenderPlan {
  flats: FlatTile[];
  modules: TownModulePlacement[];
}

/**
 * Share of the all-path and all-cobble tiles drawn as the full kit tile (pebbles, loose stones)
 * instead of a flat quad textured with the same atlas tile. Cobble stays flat: its atlas tile
 * already reads as cobbles and the square's edge pieces take most of the budget.
 */
export const TERRAIN_DETAIL_SHARE: Readonly<Partial<Record<Ground, number>>> = { path: 0.12, cobble: 0 };
/**
 * Terrain variants. Pieces with grass use variant 0 only: the other variants paint their grass
 * with another swatch, which would show seams against the flat grass. Full tiles use 0 and 2,
 * which share the ground swatch (M06 `pick((0, 1, 0))`).
 */
const DETAIL_VARIANTS = [0, 2] as const;

/** Deterministic hash of a cell to [0, 1). */
export function cellHash(x: number, z: number, salt = 0): number {
  let h = (Math.imul(Math.floor(x * 2) + 7919, 73856093) ^ Math.imul(Math.floor(z * 2) + 104729, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function propVariant(module: TownPropModuleId, at: readonly number[], wanted: number | undefined): number {
  return wanted ?? Math.floor(cellHash(at[0]!, at[1]!, module.length) * 3);
}

let plan: TownRenderPlan | undefined;

export function townRenderPlan(): TownRenderPlan {
  if (plan) return plan;
  const flats: FlatTile[] = [];
  const modules: TownModulePlacement[] = [];
  const { tiles, issues } = tileTerrain(townGround());
  if (issues.length > 0) throw new Error(`town ground has ${issues.length} unrenderable tiles, first at ${issues[0]!.x}, ${issues[0]!.z}`);
  // Tiles entirely under a building are never seen.
  const under = TOWN_BUILDINGS.map(buildingArea);
  const hidden = (x: number, z: number) => under.some((a) => x >= a[0] && z >= a[1] && x + 1 <= a[2] && z + 1 <= a[3]);
  for (const t of tiles) {
    if (hidden(t.x, t.z)) continue;
    if (t.kind === "flat") {
      const detailed = cellHash(t.x, t.z, 1) < (TERRAIN_DETAIL_SHARE[t.ground] ?? 0);
      if (detailed) {
        modules.push({
          kit: "common",
          module: terrainModuleId(t.ground as FeatureGround, "full"),
          variant: DETAIL_VARIANTS[Math.floor(cellHash(t.x, t.z, 2) * DETAIL_VARIANTS.length)]!,
          position: [t.x, TERRAIN_Y, t.z + 1],
          rot: 0,
        });
      } else {
        flats.push({ ground: t.ground, x: t.x, z: t.z, y: TERRAIN_Y + TERRAIN_TOP[t.ground] });
      }
      continue;
    }
    modules.push({ kit: "common", module: t.module, variant: 0, position: [t.pivot[0], TERRAIN_Y, t.pivot[1]], rot: t.rot });
  }
  for (const p of TOWN_PROPS_LAYOUT) {
    const def = TOWN_PROPS[p.module];
    // The bridge and dock share the river-bank heights, so they sink with the terrain.
    const y = p.module === "bridge.stone" || p.module === "dock.fishing" ? TERRAIN_Y : 0;
    modules.push({ kit: def.kit, module: p.module, variant: propVariant(p.module, p.at, p.variant), position: [p.at[0], y, p.at[1]], rot: p.rot });
  }
  plan = { flats, modules };
  return plan;
}
