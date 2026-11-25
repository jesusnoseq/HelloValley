import { PLACEMENT_CELL_M } from "../assets/kit";
import { rotateXZ } from "../buildings/schema";
import {
  INTERIOR_FURNITURE,
  INTERIOR_LAYOUTS,
  INTERIOR_TABLE_TOP_M,
  type InteriorLayout,
  type InteriorPiece,
  interiorEntrance,
  interiorProblems,
  pieceArea,
  pieceSize,
  type QuarterTurn,
  type RoomSide,
  buildInteriorNavGrid,
} from "../world/interiors";
import { planPath } from "../world/movement";
import type { NavGrid } from "../world/navgrid";
import type { Area, Vec2 } from "../world/town";
import { type FurnitureId, furnitureDef, isFurnitureId } from "./furniture";

/**
 * Apartment furniture layouts and the placement rules (build plan M17, GDD §4.2: "furniture is
 * placed on a 0.5 m grid with rotation"). Pure and zod-free: the ApartmentRoom validates every
 * edit with these functions, and the client uses the same ones to colour the placement ghost
 * before it sends anything.
 *
 * A layout is what `users/{uid}/apartment/layout` stores (GDD §9.4): the placed furniture
 * `{itemId, x, z, rot}` plus the pieces put away in storage. `x, z` is the min corner of the
 * turned footprint in the apartment's interior frame (like `InteriorPiece.at`, metres) and `rot`
 * is in degrees (quarter turns; rot 0 faces +z with the back on the north side, 90 has its back
 * on the west, 180 on the south and 270 on the east).
 */

export const FURNITURE_ROTATIONS = [0, 90, 180, 270] as const;
export type FurnitureRotation = (typeof FURNITURE_ROTATIONS)[number];

export interface FurnitureEntry {
  itemId: FurnitureId;
  x: number;
  z: number;
  rot: FurnitureRotation;
}

export interface ApartmentLayoutData {
  furniture: FurnitureEntry[];
  /** Pieces in storage (the "store" action), placeable again later. */
  stored: FurnitureId[];
}

/** Most pieces that can stand in the studio at once (my number; the room is 6 × 5 m). */
export const APARTMENT_MAX_PLACED = 40;
/** Most pieces in storage. */
export const APARTMENT_MAX_STORED = 100;
/** Floor, rug and wall pieces snap to the 0.5 m placement grid. */
export const FURNITURE_GRID_M = PLACEMENT_CELL_M;
/** Pieces on a table top (the table lamp) snap to a finer grid so they can sit centred. */
export const SURFACE_GRID_M = 0.25;
/** The mirror and kitchen spots must be reachable to within this distance (the mirror's reach is 0.9 m). */
const SPOT_REACH_M = 0.8;
/** Modules whose top is a surface that surface pieces can stand on. */
const SURFACE_HOSTS = new Set<string>(["table"]);

const entry = (itemId: FurnitureId, x: number, z: number, rot: FurnitureRotation = 0): FurnitureEntry => ({ itemId, x, z, rot });

/** The studio's starting furniture: the M13 apartment (`INTERIOR_LAYOUTS.apartment`), as a layout. */
export const DEFAULT_APARTMENT_LAYOUT: Readonly<ApartmentLayoutData> = Object.freeze({
  furniture: [
    entry("kitchen_nook", 0, 0),
    entry("fern", 1.5, 0),
    entry("painting", 3, 0),
    entry("floor_lamp", 4.5, 0),
    entry("bed", 5, 0),
    entry("pantry_shelf", 0, 1, 90),
    entry("mirror", 0, 3, 90),
    entry("round_rug", 1.5, 1.5),
    entry("small_table", 2, 2),
    entry("table_lamp", 2.25, 2.25),
    entry("wooden_chair", 1.5, 2.5, 90),
    entry("wooden_chair", 3, 2.5, 270),
    entry("wardrobe", 5.5, 2.5, 270),
    entry("sofa", 3.5, 4, 180),
  ],
  stored: [],
});

export function defaultApartmentLayout(): ApartmentLayoutData {
  return cloneLayout(DEFAULT_APARTMENT_LAYOUT);
}

export function cloneLayout(layout: Readonly<ApartmentLayoutData>): ApartmentLayoutData {
  return { furniture: layout.furniture.map((e) => ({ ...e })), stored: [...layout.stored] };
}

/** The studio room (size, walls, openings) every apartment shares. */
const ROOM = INTERIOR_LAYOUTS.apartment;
/** Standing spots of the built-ins (mirror, kitchen); the other M13 spots belong to movable pieces. */
const FIXED_SPOTS: Readonly<Record<string, Vec2>> = { mirror: ROOM.spots.mirror!, kitchen: ROOM.spots.kitchen! };

export const quarterTurnOf = (rot: FurnitureRotation): QuarterTurn => (rot / 90) as QuarterTurn;
export const rotationOf = (q: number): FurnitureRotation => ((((Math.round(q) % 4) + 4) % 4) * 90) as FurnitureRotation;

/** The interior-kit piece a layout entry shows (surface pieces stand on the table top). */
export function toInteriorPiece(e: FurnitureEntry): InteriorPiece {
  const def = furnitureDef(e.itemId);
  const surface = INTERIOR_FURNITURE[def.module].mount === "surface";
  return {
    module: def.module,
    variant: def.variant,
    at: [e.x, e.z],
    rot: quarterTurnOf(e.rot),
    ...(surface ? { y: INTERIOR_TABLE_TOP_M } : {}),
  };
}

/** The area an entry covers on the floor (interior frame). */
export function entryArea(e: FurnitureEntry): Area {
  return pieceArea(toInteriorPiece(e));
}

/** Footprint size in metres of a furniture id at a rotation (x extent, z extent). */
export function furnitureSize(itemId: FurnitureId, rot: FurnitureRotation): Vec2 {
  return pieceSize({ module: furnitureDef(itemId).module, rot: quarterTurnOf(rot) });
}

/** The apartment as an interior scene (build plan M13 renderer) with this layout's furniture. */
export function apartmentInteriorLayout(layout: Readonly<ApartmentLayoutData>): InteriorLayout {
  return { ...ROOM, furniture: layout.furniture.map(toInteriorPiece), spots: FIXED_SPOTS };
}

/** The apartment's walkability grid with this layout (floor-mounted pieces block). */
export function apartmentNavGrid(layout: Readonly<ApartmentLayoutData>): NavGrid {
  return buildInteriorNavGrid(apartmentInteriorLayout(layout));
}

let openGrid: NavGrid | undefined;

/**
 * The studio with no furniture: used while an apartment's real layout is not known yet (it is
 * looser than any layout, so a walker is never corrected for furniture it cannot see).
 */
export function openApartmentNavGrid(): NavGrid {
  openGrid ??= buildInteriorNavGrid({ ...ROOM, furniture: [] });
  return openGrid;
}

const overlaps = (a: Area, b: Area) => a[0] < b[2] - 1e-9 && b[0] < a[2] - 1e-9 && a[1] < b[3] - 1e-9 && b[1] < a[3] - 1e-9;
const contains = (outer: Area, inner: Area) =>
  inner[0] >= outer[0] - 1e-9 && inner[1] >= outer[1] - 1e-9 && inner[2] <= outer[2] + 1e-9 && inner[3] <= outer[3] + 1e-9;
const onGrid = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-9;

const FIXED_DEFAULTS = DEFAULT_APARTMENT_LAYOUT.furniture.filter((e) => furnitureDef(e.itemId).fixed);

/**
 * Everything wrong with a layout (empty = valid). On top of the room rules every interior obeys
 * (`interiorProblems`: inside the room on the 0.5 m grid, wall pieces with their back on a wall
 * and not over the door or a window, floor pieces not overlapping, the entrance clear):
 * known ids and rotations, the piece limits, the built-ins in their places, surface pieces on a
 * table top, rugs not on rugs, wall pieces not on each other, and the mirror and the kitchen
 * reachable from the entrance.
 */
export function layoutProblems(layout: Readonly<ApartmentLayoutData>): string[] {
  const problems: string[] = [];
  const { furniture, stored } = layout;
  if (!Array.isArray(furniture) || !Array.isArray(stored)) return ["not a layout"];
  if (furniture.length > APARTMENT_MAX_PLACED) problems.push(`more than ${APARTMENT_MAX_PLACED} pieces placed`);
  if (stored.length > APARTMENT_MAX_STORED) problems.push(`more than ${APARTMENT_MAX_STORED} pieces stored`);
  for (const id of stored) {
    if (!isFurnitureId(id)) problems.push(`unknown stored piece ${String(id)}`);
    else if (furnitureDef(id).fixed) problems.push(`${id} is a built-in and cannot be stored`);
  }
  const bad = furniture.filter(
    (e) => !isFurnitureId(e.itemId) || !FURNITURE_ROTATIONS.includes(e.rot) || !Number.isFinite(e.x) || !Number.isFinite(e.z),
  );
  if (bad.length) return [...problems, ...bad.map((e) => `malformed piece ${JSON.stringify(e)}`)];

  for (const fixed of FIXED_DEFAULTS) {
    const placed = furniture.filter((e) => e.itemId === fixed.itemId);
    if (placed.length !== 1 || placed[0]!.x !== fixed.x || placed[0]!.z !== fixed.z || placed[0]!.rot !== fixed.rot) {
      problems.push(`${fixed.itemId} is a built-in and must stay at ${fixed.x}, ${fixed.z}`);
    }
  }

  const interior = apartmentInteriorLayout(layout);
  problems.push(...interiorProblems(interior));

  const areas = furniture.map(entryArea);
  const mounts = furniture.map((e) => INTERIOR_FURNITURE[furnitureDef(e.itemId).module].mount);
  furniture.forEach((e, k) => {
    const label = `${e.itemId}#${k}`;
    if (mounts[k] === "surface") {
      if (!onGrid(e.x, SURFACE_GRID_M) || !onGrid(e.z, SURFACE_GRID_M)) problems.push(`${label}: not on the ${SURFACE_GRID_M} m grid`);
      const host = furniture.some((h, j) => SURFACE_HOSTS.has(furnitureDef(h.itemId).module) && contains(areas[j]!, areas[k]!));
      if (!host) problems.push(`${label}: must stand on a table`);
    }
    for (let j = 0; j < k; j++) {
      const same = mounts[j] === mounts[k] && (mounts[k] === "rug" || mounts[k] === "wall" || mounts[k] === "surface");
      if (same && overlaps(areas[j]!, areas[k]!)) problems.push(`${label} overlaps ${furniture[j]!.itemId}#${j}`);
    }
  });

  // Nobody may be shut out of the mirror or the kitchen.
  if (problems.length === 0) {
    const grid = buildInteriorNavGrid(interior);
    const start = interiorEntrance(interior).arrival;
    for (const [name, spot] of Object.entries(FIXED_SPOTS)) {
      // planPath snaps a blocked goal to the nearest free cell: that must still be within reach.
      const path = planPath(grid, start, spot);
      const end = path ? (path.at(-1) ?? start) : null;
      if (!end || Math.hypot(end[0] - spot[0], end[1] - spot[1]) > SPOT_REACH_M) problems.push(`the ${name} cannot be reached from the door`);
    }
  }
  return problems;
}

export function isValidLayout(layout: Readonly<ApartmentLayoutData>): boolean {
  return layoutProblems(layout).length === 0;
}

// ---------------------------------------------------------------------------------------------
// Edits

/**
 * One placement-mode action by the owner: move (or rotate) a placed piece, put one in storage,
 * or place one from storage. `index` addresses `layout.furniture`; `itemId` must match the piece
 * there, so an edit made against an outdated copy of the layout is refused rather than applied
 * to the wrong piece.
 */
export type FurnitureEdit =
  | { op: "move"; index: number; itemId: FurnitureId; x: number; z: number; rot: FurnitureRotation }
  | { op: "store"; index: number; itemId: FurnitureId }
  | { op: "place"; itemId: FurnitureId; x: number; z: number; rot: FurnitureRotation };

export type FurnitureEditRejection = "not_found" | "fixed" | "not_stored" | "full" | "invalid";

export type FurnitureEditResult =
  | { ok: true; layout: ApartmentLayoutData }
  | { ok: false; reason: FurnitureEditRejection; problems: string[] };

const reject = (reason: FurnitureEditRejection, problems: string[] = []): FurnitureEditResult => ({ ok: false, reason, problems });

/** Indexes of the surface pieces standing on the piece at `index` (a table). */
function carriedBy(layout: Readonly<ApartmentLayoutData>, index: number): number[] {
  const host = layout.furniture[index]!;
  if (!SURFACE_HOSTS.has(furnitureDef(host.itemId).module)) return [];
  const area = entryArea(host);
  const out: number[] = [];
  layout.furniture.forEach((e, k) => {
    if (k !== index && INTERIOR_FURNITURE[furnitureDef(e.itemId).module].mount === "surface" && contains(area, entryArea(e))) out.push(k);
  });
  return out;
}

const centreOf = (a: Area): Vec2 => [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2];
const snap = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Applies one edit and validates the result with `layoutProblems`. The input is not changed.
 * Moving a table carries what stands on it (turned with it); storing a table stores those too.
 */
export function applyFurnitureEdit(layout: Readonly<ApartmentLayoutData>, edit: FurnitureEdit): FurnitureEditResult {
  if (!isFurnitureId(edit.itemId)) return reject("not_found");
  const next = cloneLayout(layout);
  if (edit.op === "place") {
    const k = next.stored.indexOf(edit.itemId);
    if (k < 0) return reject("not_stored");
    if (next.furniture.length >= APARTMENT_MAX_PLACED) return reject("full");
    next.stored.splice(k, 1);
    next.furniture.push({ itemId: edit.itemId, x: edit.x, z: edit.z, rot: edit.rot });
  } else {
    const current = next.furniture[edit.index];
    if (!Number.isInteger(edit.index) || !current || current.itemId !== edit.itemId) return reject("not_found");
    if (furnitureDef(current.itemId).fixed) return reject("fixed");
    const carried = carriedBy(layout, edit.index);
    if (edit.op === "store") {
      if (next.stored.length + 1 + carried.length > APARTMENT_MAX_STORED) return reject("full");
      const gone = new Set([edit.index, ...carried]);
      next.stored.push(current.itemId, ...carried.map((k) => next.furniture[k]!.itemId));
      next.furniture = next.furniture.filter((_, k) => !gone.has(k));
    } else {
      const before = centreOf(entryArea(current));
      const moved: FurnitureEntry = { itemId: current.itemId, x: edit.x, z: edit.z, rot: edit.rot };
      const after = centreOf(entryArea(moved));
      const turns = quarterTurnOf(edit.rot) - quarterTurnOf(current.rot);
      next.furniture[edit.index] = moved;
      for (const k of carried) {
        const e = next.furniture[k]!;
        const c = centreOf(entryArea(e));
        const off = rotateXZ(c[0] - before[0], c[1] - before[1], (((turns % 4) + 4) % 4) as QuarterTurn);
        const rot = rotationOf(quarterTurnOf(e.rot) + turns);
        const [w, d] = furnitureSize(e.itemId, rot);
        next.furniture[k] = { itemId: e.itemId, x: snap(after[0] + off[0] - w / 2, SURFACE_GRID_M), z: snap(after[1] + off[1] - d / 2, SURFACE_GRID_M), rot };
      }
    }
  }
  const problems = layoutProblems(next);
  return problems.length ? reject("invalid", problems) : { ok: true, layout: next };
}

// ---------------------------------------------------------------------------------------------
// Placement-mode helpers (the client's ghost)

const BACK_ROT: Readonly<Record<RoomSide, FurnitureRotation>> = { north: 0, west: 90, south: 180, east: 270 };

/** Whether a furniture id must hang on or stand against a wall (its rotation follows that wall). */
export function needsWall(itemId: FurnitureId): boolean {
  const f = INTERIOR_FURNITURE[furnitureDef(itemId).module];
  return f.mount === "wall" || f.againstWall;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where a piece would go with the pointer at `point`: its footprint centred on the point and
 * snapped to the grid (0.5 m, or 0.25 m on table tops), kept inside the room. Pieces that belong
 * against a wall snap to the nearest wall instead, turned with their back to it (`rot` is
 * ignored for them).
 */
export function snapPlacement(itemId: FurnitureId, point: Vec2, rot: FurnitureRotation): Omit<FurnitureEntry, "itemId"> {
  const { w: W, d: D } = ROOM;
  const step = INTERIOR_FURNITURE[furnitureDef(itemId).module].mount === "surface" ? SURFACE_GRID_M : FURNITURE_GRID_M;
  const px = clamp(point[0], 0, W);
  const pz = clamp(point[1], 0, D);
  if (needsWall(itemId)) {
    const dists: [RoomSide, number][] = [
      ["north", pz],
      ["south", D - pz],
      ["west", px],
      ["east", W - px],
    ];
    const side = dists.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
    const r = BACK_ROT[side];
    const [w, d] = furnitureSize(itemId, r);
    if (side === "north" || side === "south") {
      return { x: clamp(snap(px - w / 2, step), 0, W - w), z: side === "north" ? 0 : D - d, rot: r };
    }
    return { x: side === "west" ? 0 : W - w, z: clamp(snap(pz - d / 2, step), 0, D - d), rot: r };
  }
  const [w, d] = furnitureSize(itemId, rot);
  return { x: clamp(snap(px - w / 2, step), 0, W - w), z: clamp(snap(pz - d / 2, step), 0, D - d), rot };
}

const PICK_PRIORITY = { surface: 0, floor: 1, wall: 2, rug: 3 } as const;

/**
 * The placed piece under a floor point (for picking one up in placement mode), or null. Table-top
 * pieces win over the table, furniture over the wall decor behind it, everything over rugs.
 */
export function furnitureAt(layout: Readonly<ApartmentLayoutData>, point: Vec2): number | null {
  let best: { k: number; rank: number } | null = null;
  layout.furniture.forEach((e, k) => {
    const a = entryArea(e);
    if (point[0] < a[0] || point[0] > a[2] || point[1] < a[1] || point[1] > a[3]) return;
    const rank = PICK_PRIORITY[INTERIOR_FURNITURE[furnitureDef(e.itemId).module].mount];
    if (!best || rank < best.rank) best = { k, rank };
  });
  return (best as { k: number } | null)?.k ?? null;
}

/**
 * The layout an ApartmentRoom starts from: the stored one when it is valid, else the starting
 * furniture (a missing document, or one a newer rule no longer accepts).
 */
export function layoutOrDefault(stored: Readonly<ApartmentLayoutData> | null): ApartmentLayoutData {
  return stored && isValidLayout(stored) ? cloneLayout(stored) : defaultApartmentLayout();
}
