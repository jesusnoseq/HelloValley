import { groundIndex, type GroundMap } from "./terrain";
import { townGround } from "./town";

/**
 * Distance to the river shore over the town (build plan M12). The river shader uses it for the
 * depth tint (deeper water further from the bank) and the foam line along the banks; fishing can
 * use it later for cast distances. The shore runs along the water cells' borders (the M06 bank
 * pieces cross every tile side at its midpoint, see terrain.ts), so the field is the signed
 * distance to the union of water cells: positive over water, negative on land.
 */

export interface ShoreField {
  /** Samples per row and per column. */
  w: number;
  d: number;
  /** Metres per sample; sample (i, j) sits at ((i + 0.5) * cell, (j + 0.5) * cell). */
  cell: number;
  /** Distances are clamped to [-landRange, waterRange] metres. */
  landRange: number;
  waterRange: number;
  /** Signed distance per sample, row-major (index = j * w + i). */
  data: Float32Array;
}

export interface ShoreFieldOptions {
  cell?: number;
  landRange?: number;
  waterRange?: number;
}

export const SHORE_FIELD_CELL = 0.25;
export const SHORE_LAND_RANGE = 2;
export const SHORE_WATER_RANGE = 4;

/** Distance from point (px, pz) to the 1 x 1 cell square at (cx, cz). */
function squareDistance(px: number, pz: number, cx: number, cz: number): number {
  const dx = Math.max(cx - px, 0, px - (cx + 1));
  const dz = Math.max(cz - pz, 0, pz - (cz + 1));
  return Math.hypot(dx, dz);
}

/** Signed shore distance of a ground map (see the module comment). */
export function shoreField(map: GroundMap, options: ShoreFieldOptions = {}): ShoreField {
  const cell = options.cell ?? SHORE_FIELD_CELL;
  const landRange = options.landRange ?? SHORE_LAND_RANGE;
  const waterRange = options.waterRange ?? SHORE_WATER_RANGE;
  const w = Math.round(map.w / cell);
  const d = Math.round(map.d / cell);
  const water = groundIndex("water");
  const isWater = (x: number, z: number) => x >= 0 && z >= 0 && x < map.w && z < map.d && map.cells[z * map.w + x] === water;
  const data = new Float32Array(w * d);
  const reach = Math.ceil(Math.max(landRange, waterRange)) + 1;
  // Ground cells with a cell of the other kind within reach; the rest are saturated.
  const near = new Uint8Array(map.w * map.d);
  for (let cz = 0; cz < map.d; cz++) {
    for (let cx = 0; cx < map.w; cx++) {
      const wet = isWater(cx, cz);
      search: for (let z = Math.max(0, cz - reach); z <= Math.min(map.d - 1, cz + reach); z++) {
        for (let x = Math.max(0, cx - reach); x <= Math.min(map.w - 1, cx + reach); x++) {
          if (isWater(x, z) !== wet) {
            near[cz * map.w + cx] = 1;
            break search;
          }
        }
      }
    }
  }
  for (let j = 0; j < d; j++) {
    const pz = (j + 0.5) * cell;
    const cz = Math.floor(pz);
    for (let i = 0; i < w; i++) {
      const px = (i + 0.5) * cell;
      const cx = Math.floor(px);
      const wet = isWater(cx, cz);
      const range = wet ? waterRange : landRange;
      // Nearest cell of the other kind. Off-map cells are ignored, so the river runs into the
      // diorama's edge at full depth rather than with a foam line along the base.
      let best = range;
      const ci = Math.min(map.w - 1, cx);
      const cj = Math.min(map.d - 1, cz);
      if (!near[cj * map.w + ci]) {
        data[j * w + i] = wet ? best : -best;
        continue;
      }
      for (let z = Math.max(0, cz - reach); z <= Math.min(map.d - 1, cz + reach); z++) {
        for (let x = Math.max(0, cx - reach); x <= Math.min(map.w - 1, cx + reach); x++) {
          if (isWater(x, z) === wet) continue;
          const dist = squareDistance(px, pz, x, z);
          if (dist < best) best = dist;
        }
      }
      data[j * w + i] = wet ? best : -best;
    }
  }
  return { w, d, cell, landRange, waterRange, data };
}

/** Bilinear sample of the field at a point of the town frame (clamped at the edges). */
export function sampleShore(field: ShoreField, x: number, z: number): number {
  const fx = Math.min(field.w - 1, Math.max(0, x / field.cell - 0.5));
  const fz = Math.min(field.d - 1, Math.max(0, z / field.cell - 0.5));
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const i1 = Math.min(field.w - 1, i0 + 1);
  const j1 = Math.min(field.d - 1, j0 + 1);
  const tx = fx - i0;
  const tz = fz - j0;
  const at = (i: number, j: number) => field.data[j * field.w + i]!;
  const top = at(i0, j0) * (1 - tx) + at(i1, j0) * tx;
  const bottom = at(i0, j1) * (1 - tx) + at(i1, j1) * tx;
  return top * (1 - tz) + bottom * tz;
}

/** Encode the field as bytes for an R8 texture: 0 = -landRange, 255 = +waterRange. */
export function encodeShoreField(field: ShoreField): Uint8Array {
  const span = field.landRange + field.waterRange;
  const out = new Uint8Array(field.data.length);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(((field.data[k]! + field.landRange) / span) * 255);
  return out;
}

let town: ShoreField | undefined;

/** The town's shore field (computed once). */
export function townShoreField(): ShoreField {
  return (town ??= shoreField(townGround()));
}
