import { townBlockers } from "./navgrid";
import { cellHash } from "./render";
import { groundIndex, type GroundMap } from "./terrain";
import { type Area, townGround } from "./town";

/**
 * Swaying vegetation (build plan M12): which town modules are plants (their canopies sway in the
 * client's vertex shader) and where the small grass and flower clusters grow. Pure data, so the
 * triangle budget of the instanced vegetation can be tested against the kit manifests.
 */

/** Common-kit modules whose `canopy` meshes sway: trees, bushes and flower beds. */
export function isPlantModule(id: string): boolean {
  return id.startsWith("tree.") || id === "bush" || id === "flowers";
}

/** Grass cluster looks: two plain tufts and two with a small bloom (pink, butter yellow). */
export const GRASS_TUFT_VARIANTS = 4;

export interface GrassTuft {
  x: number;
  z: number;
  /** Turn about +Y in radians. */
  yaw: number;
  /** Uniform scale, about 0.8–1.2. */
  scale: number;
  variant: number;
}

/** Share of the open grass cells that grow a cluster. */
export const GRASS_TUFT_SHARE = 0.12;
/** Clearance from anything that blocks walking (buildings, props, tree trunks), in metres. */
export const GRASS_TUFT_CLEARANCE = 0.35;

function inArea(a: Area, x: number, z: number, margin: number): boolean {
  return x >= a[0] - margin && x <= a[2] + margin && z >= a[1] - margin && z <= a[3] + margin;
}

/**
 * Grass clusters on open grass: a cell grows one when it and its eight neighbours are grass (so
 * clusters keep off paths, cobbles and banks) and a deterministic hash picks it, at a jittered
 * point clear of every blocker.
 */
export function grassTufts(map: GroundMap, blockers: readonly Area[], share = GRASS_TUFT_SHARE): GrassTuft[] {
  const grass = groundIndex("grass");
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= map.w || z >= map.d ? -1 : map.cells[z * map.w + x]);
  const out: GrassTuft[] = [];
  for (let z = 1; z < map.d - 1; z++) {
    for (let x = 1; x < map.w - 1; x++) {
      if (cellHash(x, z, 31) >= share) continue;
      let open = true;
      for (let dz = -1; dz <= 1 && open; dz++) for (let dx = -1; dx <= 1 && open; dx++) open = at(x + dx, z + dz) === grass;
      if (!open) continue;
      const px = x + 0.2 + 0.6 * cellHash(x, z, 32);
      const pz = z + 0.2 + 0.6 * cellHash(x, z, 33);
      if (blockers.some((a) => inArea(a, px, pz, GRASS_TUFT_CLEARANCE))) continue;
      const v = cellHash(x, z, 34);
      out.push({
        x: px,
        z: pz,
        yaw: cellHash(x, z, 35) * Math.PI * 2,
        scale: 0.8 + 0.4 * cellHash(x, z, 36),
        variant: v < 0.4 ? 0 : v < 0.8 ? 1 : v < 0.9 ? 2 : 3,
      });
    }
  }
  return out;
}

let tufts: GrassTuft[] | undefined;

/** The town's grass clusters (computed once). */
export function townGrassTufts(): readonly GrassTuft[] {
  return (tufts ??= grassTufts(
    townGround(),
    townBlockers().map((b) => b.area),
  ));
}
