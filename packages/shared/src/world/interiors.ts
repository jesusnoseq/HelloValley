import type { InteriorModuleId } from "../assets/interior";
import { PLACEMENT_CELL_M, type PlacementMount } from "../assets/kit";
import type { BuildingRecipeId } from "../buildings/schema";
import { rotateXZ } from "../buildings/schema";
import { createNavGrid, fillOverlapping, type NavGrid } from "./navgrid";
import { type Area, rectToTown, type Vec2 } from "./town";

/**
 * Interior scenes (build plan M13, GDD §4.1: "each building has an interior scene; the camera
 * cuts away the exterior walls and roof, diorama style"). Every town building's door leads to
 * one single-room interior built from the interior kit (M08); the apartment block's door leads
 * to the player's own apartment (GDD §4.2).
 *
 * Interior frame: metres, x east, z south, y up, like the town. The floor covers x in [0, w] and
 * z in [0, d]; the walls stand just outside it, 0.1 m thick (north and south walls stretch 0.1 m
 * past each end so the corners close). Furniture `at` is the min corner of its (turned)
 * placement footprint on the 0.5 m grid, and `rot` turns it in quarter turns like kit modules
 * (rot 0: its front faces +z, its back edge is on the north side). Pure data: the server can
 * build the same walkability grids.
 */

export const INTERIOR_IDS = [
  "apartment",
  "bakery",
  "farm",
  "general_store",
  "clinic",
  "cafe",
  "gossip_house",
  "town_hall",
  "library",
  "elder_cottage",
] as const;
export type InteriorId = (typeof INTERIOR_IDS)[number];

export function isInteriorId(value: unknown): value is InteriorId {
  return typeof value === "string" && (INTERIOR_IDS as readonly string[]).includes(value);
}

/** The interior a building's door leads to. */
export function interiorForBuilding(id: BuildingRecipeId): InteriorId {
  return id === "apartment_block" ? "apartment" : id;
}

/** The town building whose door leads to an interior. */
export function buildingForInterior(id: InteriorId): BuildingRecipeId {
  return id === "apartment" ? "apartment_block" : id;
}

/** Room wall thickness (interior kit `iwall.*`: a 0.1 m slab at the back of its cell). */
export const INTERIOR_WALL_T = 0.1;
export const INTERIOR_WALL_H = 3;

export const ROOM_SIDES = ["north", "east", "south", "west"] as const;
export type RoomSide = (typeof ROOM_SIDES)[number];

/** Outward normal of each wall. */
export const ROOM_SIDE_NORMALS: Readonly<Record<RoomSide, Vec2>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
};

/**
 * Placement footprints of the interior furniture, in 0.5 m cells, mirrored from
 * kits/interior/kit-manifest.json (`placement`) so the server needs no manifest; a test keeps
 * them equal.
 */
export const INTERIOR_FURNITURE = {
  bed: { w: 2, d: 4, mount: "floor", againstWall: true },
  table: { w: 2, d: 2, mount: "floor", againstWall: false },
  chair: { w: 1, d: 1, mount: "floor", againstWall: false },
  sofa: { w: 3, d: 2, mount: "floor", againstWall: true },
  wardrobe: { w: 2, d: 1, mount: "floor", againstWall: true },
  mirror: { w: 1, d: 1, mount: "wall", againstWall: false },
  "kitchen.nook": { w: 3, d: 1, mount: "floor", againstWall: true },
  shelf: { w: 2, d: 1, mount: "floor", againstWall: true },
  "plant.potted": { w: 1, d: 1, mount: "floor", againstWall: false },
  rug: { w: 3, d: 3, mount: "rug", againstWall: false },
  "lamp.floor": { w: 1, d: 1, mount: "floor", againstWall: false },
  "lamp.table": { w: 1, d: 1, mount: "surface", againstWall: false },
  painting: { w: 2, d: 1, mount: "wall", againstWall: false },
  "bakery.counter": { w: 4, d: 2, mount: "floor", againstWall: false },
  "bakery.oven": { w: 3, d: 2, mount: "floor", againstWall: true },
  "store.shelf": { w: 4, d: 1, mount: "floor", againstWall: true },
  "cafe.bar": { w: 4, d: 2, mount: "floor", againstWall: false },
  "clinic.desk": { w: 3, d: 2, mount: "floor", againstWall: false },
  "library.shelf": { w: 2, d: 1, mount: "floor", againstWall: true },
  "townhall.desk": { w: 4, d: 2, mount: "floor", againstWall: false },
  "barn.stall": { w: 3, d: 3, mount: "floor", againstWall: false },
  "barn.hay": { w: 2, d: 1, mount: "floor", againstWall: false },
} as const satisfies Partial<Record<InteriorModuleId, { w: number; d: number; mount: PlacementMount; againstWall: boolean }>>;
export type FurnitureModuleId = keyof typeof INTERIOR_FURNITURE;

export type QuarterTurn = 0 | 1 | 2 | 3;
export type FloorModuleId = "floor.wood" | "floor.tile" | "floor.stone";

export interface InteriorPiece {
  module: FurnitureModuleId;
  variant: number;
  /** Min corner (x, z) of the turned footprint, on the 0.5 m grid. */
  at: Vec2;
  rot: QuarterTurn;
  /** Height it stands at (surface pieces on a table top), metres. */
  y?: number;
}

export interface InteriorLayout {
  id: InteriorId;
  /** Floor size in whole metres. */
  w: number;
  d: number;
  floor: { module: FloorModuleId; variant: number };
  /** Variant of every wall panel. */
  wallVariant: number;
  /** The entrance (an `iwall.door` panel): wall side and 1 m slot (west→east or north→south). */
  door: { side: RoomSide; slot: number };
  windows: readonly { side: RoomSide; slot: number }[];
  furniture: readonly InteriorPiece[];
  /**
   * Named standing points (the counter where you are served, the mirror...). Every one must be
   * reachable from the entrance. TODO(M18+): NPC posts and interactables use them.
   */
  spots: Readonly<Record<string, Vec2>>;
}

const piece = (module: FurnitureModuleId, x: number, z: number, rot: QuarterTurn = 0, variant = 0, y?: number): InteriorPiece => ({
  module,
  variant,
  at: [x, z],
  rot,
  ...(y === undefined ? {} : { y }),
});

/** Table top height (interior kit `table` `top` socket). Surface pieces stand at it. */
export const INTERIOR_TABLE_TOP_M = 0.78;
const TABLE_TOP = INTERIOR_TABLE_TOP_M;

/**
 * The rooms. Entrances are on the south wall (the camera side at the default view, so it is cut
 * away and the doorway shows as a gap in the low wall stub); windows mostly on the north and
 * west walls, which stay up.
 */
export const INTERIOR_LAYOUTS: Readonly<Record<InteriorId, InteriorLayout>> = {
  // GDD §4.2: a small studio with a bed, kitchen nook, table, window, mirror and wardrobe.
  // This is the starting furniture; the owner's stored layout (users/{uid}/apartment/layout,
  // shared apartment/layout.ts) replaces it in their ApartmentRoom (build plan M17).
  apartment: {
    id: "apartment",
    w: 6,
    d: 5,
    floor: { module: "floor.wood", variant: 0 },
    wallVariant: 0,
    door: { side: "south", slot: 2 },
    windows: [
      { side: "north", slot: 2 },
      { side: "west", slot: 2 },
    ],
    furniture: [
      piece("kitchen.nook", 0, 0, 0, 0),
      piece("plant.potted", 1.5, 0, 0, 1),
      piece("painting", 3, 0, 0, 0),
      piece("lamp.floor", 4.5, 0, 0, 0),
      piece("bed", 5, 0, 0, 0),
      piece("shelf", 0, 1, 1, 2),
      piece("mirror", 0, 3, 1, 0),
      piece("rug", 1.5, 1.5, 0, 0),
      piece("table", 2, 2, 0, 1),
      piece("lamp.table", 2.25, 2.25, 0, 0, TABLE_TOP),
      piece("chair", 1.5, 2.5, 1, 0),
      piece("chair", 3, 2.5, 3, 0),
      piece("wardrobe", 5.5, 2.5, 3, 0),
      piece("sofa", 3.5, 4, 2, 1),
    ],
    spots: { mirror: [0.75, 3.25], bed: [4.5, 1.5], kitchen: [0.75, 0.9], wardrobe: [5, 3] },
  },
  bakery: {
    id: "bakery",
    w: 6,
    d: 5,
    floor: { module: "floor.tile", variant: 0 },
    wallVariant: 1,
    door: { side: "south", slot: 3 },
    windows: [
      { side: "north", slot: 1 },
      { side: "north", slot: 5 },
      { side: "west", slot: 3 },
    ],
    furniture: [
      piece("bakery.oven", 2.5, 0, 0, 0),
      piece("bakery.counter", 2, 1.5, 0, 0),
      piece("shelf", 0, 1.5, 1, 1),
      piece("plant.potted", 5.5, 0, 0, 2),
      piece("table", 4.5, 3.5, 0, 1),
      piece("chair", 4, 3.5, 1, 1),
      piece("chair", 5.5, 3.5, 3, 1),
    ],
    spots: { counter: [3, 2.9], vendor: [3, 1.25] },
  },
  // The farm barn.
  farm: {
    id: "farm",
    w: 7,
    d: 6,
    floor: { module: "floor.stone", variant: 0 },
    wallVariant: 2,
    door: { side: "south", slot: 3 },
    windows: [
      { side: "north", slot: 5 },
      { side: "west", slot: 2 },
    ],
    furniture: [
      piece("barn.stall", 0.5, 0, 0, 0),
      piece("barn.stall", 2, 0, 0, 1),
      piece("barn.hay", 4.5, 0, 0, 0),
      piece("barn.hay", 6.5, 1, 3, 1),
      piece("barn.hay", 6.5, 2, 3, 2),
      piece("shelf", 0, 3, 1, 0),
      piece("plant.potted", 6.5, 5, 0, 0),
    ],
    spots: { stalls: [2, 2], hay: [5.8, 2] },
  },
  general_store: {
    id: "general_store",
    w: 7,
    d: 5,
    floor: { module: "floor.wood", variant: 1 },
    wallVariant: 0,
    door: { side: "south", slot: 3 },
    windows: [
      { side: "north", slot: 3 },
      { side: "west", slot: 4 },
    ],
    furniture: [
      piece("store.shelf", 0.5, 0, 0, 0),
      piece("store.shelf", 4.5, 0, 0, 1),
      piece("store.shelf", 0, 1.5, 1, 2),
      piece("store.shelf", 6.5, 1.5, 3, 0),
      piece("cafe.bar", 2.5, 1.5, 0, 0),
      piece("plant.potted", 6.5, 4, 0, 1),
    ],
    spots: { counter: [3.5, 2.9], vendor: [3.5, 1.25], shelves: [1.25, 3] },
  },
  clinic: {
    id: "clinic",
    w: 6,
    d: 5,
    floor: { module: "floor.tile", variant: 1 },
    wallVariant: 2,
    door: { side: "south", slot: 2 },
    windows: [
      { side: "north", slot: 1 },
      { side: "north", slot: 4 },
    ],
    furniture: [
      piece("clinic.desk", 2.5, 1, 0, 0),
      piece("shelf", 2.5, 0, 0, 1),
      piece("plant.potted", 0, 0, 0, 2),
      piece("painting", 0, 1, 1, 1),
      piece("chair", 0, 2.5, 1, 2),
      piece("chair", 0, 3.5, 1, 2),
      piece("bed", 4, 2.5, 3, 1),
    ],
    spots: { desk: [3.25, 2.4], waiting: [1, 3.25], bed: [4.5, 4] },
  },
  cafe: {
    id: "cafe",
    w: 7,
    d: 6,
    floor: { module: "floor.wood", variant: 2 },
    wallVariant: 1,
    door: { side: "south", slot: 3 },
    windows: [
      { side: "north", slot: 4 },
      { side: "north", slot: 6 },
      { side: "west", slot: 4 },
    ],
    furniture: [
      piece("kitchen.nook", 1, 0, 0, 1),
      piece("shelf", 3, 0, 0, 2),
      piece("cafe.bar", 1, 1, 0, 1),
      piece("plant.potted", 6.5, 0, 0, 0),
      piece("lamp.floor", 0, 2, 0, 1),
      piece("painting", 0, 1, 1, 2),
      piece("sofa", 0, 3, 1, 2),
      piece("table", 4, 2, 0, 0),
      piece("chair", 3.5, 2.5, 1, 1),
      piece("chair", 5, 2.5, 3, 1),
      piece("table", 5, 4, 0, 2),
      piece("lamp.table", 5.25, 4.25, 0, 1, TABLE_TOP),
      piece("chair", 4.5, 4.5, 1, 2),
      piece("chair", 6, 4.5, 3, 2),
    ],
    spots: { counter: [2, 2.4], vendor: [2, 0.75], window_table: [4.5, 3.5] },
  },
  gossip_house: {
    id: "gossip_house",
    w: 6,
    d: 5,
    floor: { module: "floor.wood", variant: 1 },
    wallVariant: 1,
    door: { side: "south", slot: 2 },
    windows: [
      { side: "north", slot: 5 },
      { side: "west", slot: 3 },
    ],
    furniture: [
      piece("lamp.floor", 0, 0, 0, 2),
      piece("sofa", 1, 0, 0, 0),
      piece("painting", 3, 0, 0, 1),
      piece("plant.potted", 5.5, 0, 0, 0),
      piece("rug", 1, 1.5, 0, 1),
      piece("shelf", 0, 1.5, 1, 1),
      piece("table", 3.5, 2, 0, 2),
      piece("lamp.table", 3.75, 2.25, 0, 2, TABLE_TOP),
      piece("chair", 3, 2.5, 1, 2),
      piece("chair", 4.5, 2.5, 3, 2),
      piece("wardrobe", 5.5, 2, 3, 2),
    ],
    spots: { sofa: [1.75, 1.4], table: [4, 3.5] },
  },
  town_hall: {
    id: "town_hall",
    w: 8,
    d: 6,
    floor: { module: "floor.stone", variant: 1 },
    wallVariant: 0,
    door: { side: "south", slot: 4 },
    windows: [
      { side: "north", slot: 1 },
      { side: "north", slot: 6 },
      { side: "west", slot: 4 },
    ],
    furniture: [
      piece("plant.potted", 0, 0, 0, 0),
      piece("library.shelf", 2.5, 0, 0, 0),
      piece("painting", 3.5, 0, 0, 2),
      piece("library.shelf", 4.5, 0, 0, 1),
      piece("plant.potted", 7.5, 0, 0, 2),
      piece("townhall.desk", 3, 1.5, 0, 0),
      piece("rug", 3.5, 3, 0, 2),
      piece("sofa", 0, 2, 1, 1),
      piece("shelf", 7.5, 2, 3, 0),
    ],
    spots: { desk: [4, 2.9], vendor: [4, 1.25], board: [6.5, 4] },
  },
  library: {
    id: "library",
    w: 8,
    d: 6,
    floor: { module: "floor.wood", variant: 0 },
    wallVariant: 2,
    door: { side: "south", slot: 4 },
    windows: [
      { side: "north", slot: 3 },
      { side: "north", slot: 4 },
    ],
    furniture: [
      piece("library.shelf", 0.5, 0, 0, 0),
      piece("library.shelf", 1.5, 0, 0, 1),
      piece("library.shelf", 5.5, 0, 0, 2),
      piece("library.shelf", 6.5, 0, 0, 0),
      piece("library.shelf", 0, 1.5, 1, 1),
      piece("library.shelf", 0, 2.5, 1, 2),
      piece("library.shelf", 7.5, 1.5, 3, 0),
      piece("library.shelf", 7.5, 2.5, 3, 1),
      piece("townhall.desk", 3, 1, 0, 2),
      piece("table", 1.5, 3.5, 0, 0),
      piece("lamp.table", 1.75, 3.75, 0, 1, TABLE_TOP),
      piece("chair", 1, 3.5, 1, 0),
      piece("chair", 2.5, 3.5, 3, 0),
      piece("table", 5.5, 3.5, 0, 0),
      piece("lamp.table", 5.75, 3.75, 0, 2, TABLE_TOP),
      piece("chair", 5, 3.5, 1, 0),
      piece("chair", 6.5, 3.5, 3, 0),
      piece("plant.potted", 0, 5.5, 0, 1),
    ],
    spots: { desk: [4, 2.4], vendor: [4, 0.6], reading: [3.5, 4] },
  },
  elder_cottage: {
    id: "elder_cottage",
    w: 5,
    d: 5,
    floor: { module: "floor.wood", variant: 2 },
    wallVariant: 2,
    door: { side: "south", slot: 2 },
    windows: [{ side: "north", slot: 2 }],
    furniture: [
      piece("kitchen.nook", 0, 0, 0, 2),
      piece("lamp.floor", 3.5, 0, 0, 1),
      piece("bed", 4, 0, 0, 2),
      piece("shelf", 0, 1.5, 1, 0),
      piece("painting", 0, 3, 1, 0),
      piece("rug", 1.5, 1.5, 0, 2),
      piece("table", 2, 2, 0, 1),
      piece("chair", 1.5, 2.5, 1, 2),
      piece("plant.potted", 4.5, 4.5, 0, 1),
    ],
    spots: { table: [3.5, 2.5], kitchen: [0.75, 0.9] },
  },
};

export function interiorLayout(id: InteriorId): InteriorLayout {
  return INTERIOR_LAYOUTS[id];
}

// ---------------------------------------------------------------------------------------------
// Geometry

/** Size in metres of a piece's footprint after its quarter turn (x extent, z extent). */
export function pieceSize(p: Pick<InteriorPiece, "module" | "rot">): Vec2 {
  const f = INTERIOR_FURNITURE[p.module];
  const w = f.w * PLACEMENT_CELL_M;
  const d = f.d * PLACEMENT_CELL_M;
  return p.rot % 2 === 0 ? [w, d] : [d, w];
}

/** The area a piece covers in the interior frame. */
export function pieceArea(p: Pick<InteriorPiece, "module" | "rot" | "at">): Area {
  const [w, d] = pieceSize(p);
  return [p.at[0], p.at[1], p.at[0] + w, p.at[1] + d];
}

/** The module pivot (front-left corner of the unturned piece) that puts the footprint at `at`. */
export function piecePivot(p: Pick<InteriorPiece, "module" | "rot" | "at">): Vec2 {
  const f = INTERIOR_FURNITURE[p.module];
  const local = rectToTown({ at: [0, 0], rot: p.rot }, [0, -f.d * PLACEMENT_CELL_M, f.w * PLACEMENT_CELL_M, 0]);
  return [p.at[0] - local[0], p.at[1] - local[1]];
}

/** The direction a piece's front faces (its `use` side). */
export function pieceFront(p: Pick<InteriorPiece, "rot">): Vec2 {
  return rotateXZ(0, 1, p.rot);
}

/** Length in metres (and 1 m slots) of a wall side. */
export function sideLength(layout: Pick<InteriorLayout, "w" | "d">, side: RoomSide): number {
  return side === "north" || side === "south" ? layout.w : layout.d;
}

export type WallPanelModuleId = "iwall.plain" | "iwall.window" | "iwall.door";

/** One placed wall panel. `position` is the module pivot ([x, y, z]), `scale` stretches along x. */
export interface WallPanel {
  side: RoomSide;
  slot: number;
  module: WallPanelModuleId;
  variant: number;
  position: [number, number, number];
  rot: QuarterTurn;
  scale: [number, number, number];
}

/** Every wall panel of a room: the room face looks in, the 0.1 m slab stands outside the floor. */
export function interiorWallPanels(layout: InteriorLayout): WallPanel[] {
  const t = INTERIOR_WALL_T;
  const { w, d } = layout;
  const sx = (w + 2 * t) / w;
  const out: WallPanel[] = [];
  for (const side of ROOM_SIDES) {
    for (let k = 0; k < sideLength(layout, side); k++) {
      const module: WallPanelModuleId =
        layout.door.side === side && layout.door.slot === k
          ? "iwall.door"
          : layout.windows.some((o) => o.side === side && o.slot === k)
            ? "iwall.window"
            : "iwall.plain";
      let at: Vec2;
      let rot: QuarterTurn;
      let scale: [number, number, number] = [1, 1, 1];
      if (side === "north") {
        [at, rot, scale] = [[-t + k * sx, 1 - t], 0, [sx, 1, 1]];
      } else if (side === "south") {
        [at, rot, scale] = [[-t + (k + 1) * sx, d - 1 + t], 2, [sx, 1, 1]];
      } else if (side === "west") {
        [at, rot] = [[1 - t, k + 1], 1];
      } else {
        [at, rot] = [[w - 1 + t, k], 3];
      }
      out.push({ side, slot: k, module, variant: layout.wallVariant, position: [at[0], 0, at[1]], rot, scale });
    }
  }
  return out;
}

/** Where a wall slot's centre meets the room face (the floor edge). */
export function wallSlotCentre(layout: Pick<InteriorLayout, "w" | "d">, side: RoomSide, slot: number): Vec2 {
  const t = INTERIOR_WALL_T;
  const sx = (layout.w + 2 * t) / layout.w;
  if (side === "north") return [-t + (slot + 0.5) * sx, 0];
  if (side === "south") return [-t + (slot + 0.5) * sx, layout.d];
  if (side === "west") return [0, slot + 0.5];
  return [layout.w, slot + 0.5];
}

/** Depth of a door trigger zone in front of a door, metres (a walker stops PLAYER_RADIUS_M out). */
export const DOOR_TRIGGER_DEPTH_M = 0.45;
/** Half-width of a door trigger zone (the doorway is 0.6 m wide inside, 1 m modules outside). */
export const DOOR_TRIGGER_HALF_M = 0.35;
/** How far inside the room a walker appears after coming through the entrance. */
export const INTERIOR_ARRIVAL_M = 1;

/** A rect in front of a door: `depth` metres along `inward` from `centre`, `half` either side. */
export function doorTriggerArea(centre: Vec2, inward: Vec2, depth = DOOR_TRIGGER_DEPTH_M, half = DOOR_TRIGGER_HALF_M): Area {
  const a: Vec2 = [centre[0] + inward[1] * half, centre[1] - inward[0] * half];
  const b: Vec2 = [centre[0] - inward[1] * half + inward[0] * depth, centre[1] + inward[0] * half + inward[1] * depth];
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export interface InteriorEntrance {
  /** Doorway centre on the room face. */
  position: Vec2;
  /** Unit vector into the room. */
  inward: Vec2;
  /** Walking into this area towards the door leaves the room. */
  trigger: Area;
  /** Where a walker appears when entering. */
  arrival: Vec2;
}

export function interiorEntrance(layout: InteriorLayout): InteriorEntrance {
  const position = wallSlotCentre(layout, layout.door.side, layout.door.slot);
  const n = ROOM_SIDE_NORMALS[layout.door.side];
  const inward: Vec2 = [-n[0], -n[1]];
  return {
    position,
    inward,
    trigger: doorTriggerArea(position, inward),
    arrival: [position[0] + inward[0] * INTERIOR_ARRIVAL_M, position[1] + inward[1] * INTERIOR_ARRIVAL_M],
  };
}

/** The walkability grid of a room (0.5 m cells over the floor; floor-mounted furniture blocks). */
export function buildInteriorNavGrid(layout: InteriorLayout): NavGrid {
  const grid = createNavGrid(layout.w, layout.d);
  grid.walk.fill(1);
  for (const p of layout.furniture) {
    if (INTERIOR_FURNITURE[p.module].mount === "floor") fillOverlapping(grid, pieceArea(p), 0);
  }
  return grid;
}

const grids = new Map<InteriorId, NavGrid>();

/** A room's grid, built once. Treat it as read-only. */
export function interiorNavGrid(id: InteriorId): NavGrid {
  let g = grids.get(id);
  if (!g) grids.set(id, (g = buildInteriorNavGrid(INTERIOR_LAYOUTS[id])));
  return g;
}

const overlaps = (a: Area, b: Area) => a[0] < b[2] - 1e-9 && b[0] < a[2] - 1e-9 && a[1] < b[3] - 1e-9 && b[1] < a[3] - 1e-9;

/** The wall a piece's back edge lies on, if any. */
export function pieceBackWall(layout: Pick<InteriorLayout, "w" | "d">, p: Pick<InteriorPiece, "module" | "rot" | "at">): RoomSide | null {
  const back = pieceFront(p).map((v) => -v) as Vec2;
  const a = pieceArea(p);
  const eps = 1e-9;
  if (back[1] < 0 && Math.abs(a[1]) < eps) return "north";
  if (back[1] > 0 && Math.abs(a[3] - layout.d) < eps) return "south";
  if (back[0] < 0 && Math.abs(a[0]) < eps) return "west";
  if (back[0] > 0 && Math.abs(a[2] - layout.w) < eps) return "east";
  return null;
}

/**
 * Layout rules: sizes, openings, furniture on the 0.5 m grid inside the room, wall pieces with
 * their back on a wall (wall-mounted ones not over an opening), no two floor pieces overlapping,
 * the entrance and its arrival point clear. Reachability is checked with the movement code (tests).
 */
export function interiorProblems(layout: InteriorLayout): string[] {
  const problems: string[] = [];
  const { w, d } = layout;
  if (!Number.isInteger(w) || !Number.isInteger(d) || w < 3 || d < 3 || w > 12 || d > 12) problems.push(`room ${w} x ${d} m`);
  const openings = [{ ...layout.door, kind: "door" }, ...layout.windows.map((o) => ({ ...o, kind: "window" }))];
  const seen = new Set<string>();
  for (const o of openings) {
    if (!Number.isInteger(o.slot) || o.slot < 0 || o.slot >= sideLength(layout, o.side)) problems.push(`${o.kind} slot ${o.side} ${o.slot} is outside the wall`);
    const key = `${o.side}:${o.slot}`;
    if (seen.has(key)) problems.push(`two openings at ${key}`);
    seen.add(key);
  }
  const entrance = interiorEntrance(layout);
  const keepClear: Area[] = [entrance.trigger, [entrance.arrival[0] - 0.3, entrance.arrival[1] - 0.3, entrance.arrival[0] + 0.3, entrance.arrival[1] + 0.3]];
  const floorAreas: { label: string; area: Area }[] = [];
  layout.furniture.forEach((p, idx) => {
    const label = `${p.module}#${idx}`;
    const f = INTERIOR_FURNITURE[p.module];
    const a = pieceArea(p);
    const onGrid = (v: number) => Math.abs(v / PLACEMENT_CELL_M - Math.round(v / PLACEMENT_CELL_M)) < 1e-9;
    if (!onGrid(p.at[0]) || !onGrid(p.at[1])) {
      // Surface pieces sit centred on a table top: their quarter-metre offset is fine.
      if (f.mount !== "surface") problems.push(`${label}: not on the 0.5 m grid`);
    }
    if (a[0] < 0 || a[1] < 0 || a[2] > w + 1e-9 || a[3] > d + 1e-9) problems.push(`${label}: outside the room`);
    if (p.variant < 0 || p.variant > 2 || !Number.isInteger(p.variant)) problems.push(`${label}: variant ${p.variant}`);
    const wall = pieceBackWall(layout, p);
    if ((f.againstWall || f.mount === "wall") && !wall) problems.push(`${label}: its back must be on a wall`);
    if (f.mount === "surface" && !(p.y && p.y > 0)) problems.push(`${label}: a surface piece needs a height`);
    if (f.mount === "wall" && wall) {
      for (const o of openings) {
        if (o.side !== wall) continue;
        const c = wallSlotCentre(layout, o.side, o.slot);
        const along = wall === "north" || wall === "south" ? [a[0], a[2], c[0]] : [a[1], a[3], c[1]];
        if (along[0]! < along[2]! + 0.5 && along[2]! - 0.5 < along[1]!) problems.push(`${label}: hangs over a ${o.kind}`);
      }
    }
    if (f.mount === "floor") {
      for (const other of floorAreas) if (overlaps(other.area, a)) problems.push(`${label} overlaps ${other.label}`);
      floorAreas.push({ label, area: a });
      for (const k of keepClear) if (overlaps(k, a)) problems.push(`${label}: blocks the entrance`);
    }
  });
  if (Object.keys(layout.spots).length === 0) problems.push("no spots");
  return problems;
}
