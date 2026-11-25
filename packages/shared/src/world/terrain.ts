import { rotateXZ } from "../buildings/schema";

/**
 * Ground map and terrain tiling for the town (GDD §4.1, build plan M11).
 *
 * The town ground is a map of 1 m cells, one ground type each. It is drawn with the common kit's
 * marching-squares pieces (M06, tools/blender/hvmodules/common/base.py) on the *dual* grid: a
 * render tile spans the centres of a 2 x 2 block of ground cells, and the type of each of its
 * four corners picks the piece. The pieces cross every tile side at its midpoint, so the visible
 * border between two grounds runs exactly along the ground-cell border.
 *
 * Town frame: metres, Y up; x runs east and z runs south (the camera starts south-east of the
 * town, so north is "up" on screen). Ground cell (x, z) covers [x, x + 1] x [z, z + 1].
 */

export const GROUNDS = ["grass", "path", "cobble", "sand", "water"] as const;
export type Ground = (typeof GROUNDS)[number];
/** Grounds drawn with edge pieces against grass (water uses the river banks). */
export const FEATURE_GROUNDS = ["path", "cobble", "sand", "water"] as const satisfies readonly Ground[];
export type FeatureGround = (typeof FEATURE_GROUNDS)[number];

/** Ground index per cell, row-major (index = z * w + x). */
export interface GroundMap {
  w: number;
  d: number;
  cells: Uint8Array;
}

export function groundIndex(g: Ground): number {
  return GROUNDS.indexOf(g);
}

export function groundAt(map: GroundMap, x: number, z: number): Ground {
  const cx = Math.min(map.w - 1, Math.max(0, Math.floor(x)));
  const cz = Math.min(map.d - 1, Math.max(0, Math.floor(z)));
  return GROUNDS[map.cells[cz * map.w + cx]!]!;
}

/**
 * Heights of the M06 terrain pieces above their pivot (mirrors GROUND_Z, PATH_Z, COBBLE_Z,
 * SAND_Z, WATER_Z and BED_Z in tools/blender/hvmodules/common/base.py).
 */
export const TERRAIN_TOP: Readonly<Record<Ground, number>> = {
  grass: 0.1,
  path: 0.085,
  cobble: 0.095,
  sand: 0.08,
  water: -0.15,
};
export const RIVER_BED_Y = -0.45;
/**
 * The town sinks every terrain piece (and the bridge and dock, which share the bank heights) by
 * the grass height, so the grass top is y = 0: the plane buildings and props stand on.
 */
export const TERRAIN_Y = -TERRAIN_TOP.grass;

/** Marching-squares pieces (base.py): `edge` = feature on the front half, `outer` = only the
 * front-left quarter, `inner` = all but the back-right quarter, `full` = all of it. */
export const TERRAIN_PIECES = ["edge", "outer", "inner", "full"] as const;
export type TerrainPiece = (typeof TERRAIN_PIECES)[number];

/**
 * Tile corner bits. "Front" is +z (south), the side a module faces at rot 0, so the front-left
 * corner is (min x, max z).
 */
export const CORNER_FL = 1;
export const CORNER_FR = 2;
export const CORNER_BL = 4;
export const CORNER_BR = 8;

const PIECE_MASK: Readonly<Record<TerrainPiece, number>> = {
  edge: CORNER_FL | CORNER_FR,
  outer: CORNER_FL,
  inner: CORNER_FL | CORNER_FR | CORNER_BL,
  full: CORNER_FL | CORNER_FR | CORNER_BL | CORNER_BR,
};

/** A piece, its quarter turns and the pivot offset from the tile's front-left point (min x, max z). */
export interface PieceFit {
  piece: TerrainPiece;
  rot: number;
  offset: [number, number];
}

/** Local module corners (pivot = front-left, module covers x in [0, 1], z in [-1, 0]). */
const LOCAL_CORNERS: readonly [number, number, number][] = [
  [0, 0, CORNER_FL],
  [1, 0, CORNER_FR],
  [0, -1, CORNER_BL],
  [1, -1, CORNER_BR],
];

function cornerBit(x: number, z: number): number {
  const right = Math.round(x) === 1;
  const back = Math.round(z) === -1;
  return back ? (right ? CORNER_BR : CORNER_BL) : right ? CORNER_FR : CORNER_FL;
}

function buildFits(): Map<number, PieceFit> {
  const fits = new Map<number, PieceFit>();
  for (const piece of TERRAIN_PIECES) {
    for (let rot = 0; rot < 4; rot++) {
      const turned = LOCAL_CORNERS.map(([x, z, bit]) => {
        const [rx, rz] = rotateXZ(x, z, rot);
        return { rx, rz, bit };
      });
      // Shift the turned square back onto [0, 1] x [-1, 0].
      const ox = -Math.min(...turned.map((c) => c.rx));
      const oz = -Math.max(...turned.map((c) => c.rz));
      let mask = 0;
      for (const c of turned) if (PIECE_MASK[piece] & c.bit) mask |= cornerBit(c.rx + ox, c.rz + oz);
      if (!fits.has(mask)) fits.set(mask, { piece, rot, offset: [ox, oz] });
    }
  }
  return fits;
}

const FITS = buildFits();

/**
 * The piece and rotation that draw a feature on the tile corners in `mask`, or undefined for an
 * empty mask and the two diagonal masks, which the kit has no piece for (the layout avoids them).
 */
export function fitPiece(mask: number): PieceFit | undefined {
  return FITS.get(mask);
}

/** The common-kit module of a feature piece. */
export function terrainModuleId(ground: FeatureGround, piece: TerrainPiece): string {
  if (ground === "water") return piece === "full" ? "bank.water" : `bank.${piece === "edge" ? "straight" : piece}`;
  return piece === "full" ? `terrain.${ground}` : `terrain.${ground}.${piece}`;
}

/** One render tile of the dual grid: it spans [x, x + 1] x [z, z + 1] (x, z = cell centres). */
export type TerrainTile =
  | { kind: "flat"; ground: Ground; x: number; z: number }
  | { kind: "piece"; ground: FeatureGround; piece: TerrainPiece; module: string; x: number; z: number; rot: number; pivot: [number, number] };

export interface TerrainIssue {
  x: number;
  z: number;
  reason: "mixed" | "diagonal";
}

/** Corner grounds of the render tile whose back-left corner is the centre of cell (i, j). */
export function tileCorners(map: GroundMap, i: number, j: number): { fl: number; fr: number; bl: number; br: number } {
  const at = (x: number, z: number) => map.cells[z * map.w + x]!;
  return { bl: at(i, j), br: at(i + 1, j), fl: at(i, j + 1), fr: at(i + 1, j + 1) };
}

/**
 * Tile the ground map. Tiles whose four corners share one ground are `flat` (the client draws
 * them as textured quads, cheap enough for the whole map); the rest are kit pieces of their one
 * feature over grass. Tiles mixing two features, or with a diagonal pair, are reported in
 * `issues` (the town layout keeps a grass cell between different features).
 */
export function tileTerrain(map: GroundMap): { tiles: TerrainTile[]; issues: TerrainIssue[] } {
  const tiles: TerrainTile[] = [];
  const issues: TerrainIssue[] = [];
  const grass = groundIndex("grass");
  for (let j = 0; j < map.d - 1; j++) {
    for (let i = 0; i < map.w - 1; i++) {
      const c = tileCorners(map, i, j);
      const x = i + 0.5;
      const z = j + 0.5;
      if (c.fl === c.fr && c.fl === c.bl && c.fl === c.br) {
        tiles.push({ kind: "flat", ground: GROUNDS[c.fl]!, x, z });
        continue;
      }
      const features = new Set([c.fl, c.fr, c.bl, c.br].filter((g) => g !== grass));
      if (features.size !== 1) {
        issues.push({ x, z, reason: "mixed" });
        continue;
      }
      const feature = [...features][0]!;
      const mask = (c.fl === feature ? CORNER_FL : 0) | (c.fr === feature ? CORNER_FR : 0) | (c.bl === feature ? CORNER_BL : 0) | (c.br === feature ? CORNER_BR : 0);
      const fit = fitPiece(mask);
      if (!fit) {
        issues.push({ x, z, reason: "diagonal" });
        continue;
      }
      const ground = GROUNDS[feature] as FeatureGround;
      tiles.push({
        kind: "piece",
        ground,
        piece: fit.piece,
        module: terrainModuleId(ground, fit.piece),
        x,
        z,
        rot: fit.rot,
        // The tile's front-left point is (x, z + 1).
        pivot: [x + fit.offset[0], z + 1 + fit.offset[1]],
      });
    }
  }
  return { tiles, issues };
}
