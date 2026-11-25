import { buildingRecipe } from "../buildings/recipes";
import { type BuildingRecipeId, facadeRow, rotateXZ } from "../buildings/schema";
import type { ForageZone } from "../data/forage";
import type { PlaceId } from "../data/world";
import { type Rect, TOWN_PROPS, type TownPropModuleId } from "./props";
import { type Ground, type GroundMap, groundIndex } from "./terrain";

/**
 * The town layout (GDD §4.1, build plan M11): the "difficulty road" from the apartment block in
 * the south, past the bakery and farm, the general store and clinic, the town square with the café
 * and the gossip's house, to the town hall, the river with its bridge and fishing dock, and the
 * hill with the library and the elder's cottage in the north.
 *
 * It is plain data plus pure helpers, identical for every player and style: the server uses it
 * for walkability (TODO(M16): authoritative movement), the client renders it with the active
 * style kit. Town frame: metres, x east, z south, y up (see terrain.ts); ground cell (x, z) covers
 * [x, x + 1] x [z, z + 1]. Buildings and props are placed like kit modules: `at` is the pivot
 * (the front-left footprint corner) and `rot` the quarter turns about +Y (three.js rotateY).
 */

/** Ground map size in 1 m cells. The visible diorama is the dual grid, [0.5, W - 0.5]. */
export const TOWN_W = 64;
export const TOWN_D = 100;

export type Vec2 = [number, number];

/** Axis-aligned area in metres: x in [x0, x1), z in [z0, z1). */
export type Area = Rect;

export interface TownPlacement {
  at: Vec2;
  rot: number;
}

/** Turn and move a module-frame point (x, z) into the town frame. */
export function toTown(p: TownPlacement, local: Vec2): Vec2 {
  const [x, z] = rotateXZ(local[0], local[1], p.rot);
  return [p.at[0] + x, p.at[1] + z];
}

/** A module-frame rect, turned and moved into the town frame (still axis-aligned). */
export function rectToTown(p: TownPlacement, r: Rect): Rect {
  const a = toTown(p, [r[0], r[1]]);
  const b = toTown(p, [r[2], r[3]]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** Compose a placement inside another one's frame (a recipe prop inside its building). */
export function composePlacement(outer: TownPlacement, inner: TownPlacement): TownPlacement {
  return { at: toTown(outer, inner.at), rot: (((outer.rot + inner.rot) % 4) + 4) % 4 };
}

// ---------------------------------------------------------------------------------------------
// Ground

/** Ground painted over grass, in order (later entries win). Cells, [x0, x1) x [z0, z1). */
export const TOWN_GROUND: readonly { ground: Ground; area: Area; note: string }[] = [
  // The river crosses the whole map west to east, 5 m wide, with a jog at each end.
  { ground: "water", area: [0, 26, 14, 31], note: "river, west reach" },
  { ground: "water", area: [14, 27, 60, 32], note: "river, middle reach" },
  { ground: "water", area: [60, 28, 64, 33], note: "river, east reach" },
  // It narrows to 3 m at the bridge, which is 4 m long and lands on grass on both banks.
  { ground: "grass", area: [31, 27, 41, 28], note: "north bank at the bridge" },
  { ground: "grass", area: [31, 31, 41, 32], note: "south bank at the bridge" },
  // The cobbled road from the apartment block to the river, and the town square.
  { ground: "cobble", area: [35, 32, 38, 93], note: "main road" },
  { ground: "cobble", area: [31, 84, 35, 93], note: "apartment forecourt" },
  { ground: "cobble", area: [26, 37, 48, 55], note: "town square" },
  // Two grass flower beds by the fountain. (Grass islands cost a ring of edge pieces each, about
  // 1.7k triangles for a 2 x 1 bed, so the square's trees stand straight on the cobbles.)
  { ground: "grass", area: [36, 42, 38, 43], note: "flower bed, north of the fountain" },
  { ground: "grass", area: [36, 49, 38, 50], note: "flower bed, south of the fountain" },
  // Dirt: the hill trail from the bridge with spurs to the library and the cottage, and the farm plot.
  { ground: "path", area: [35, 13, 38, 27], note: "hill trail" },
  { ground: "path", area: [31, 13, 35, 16], note: "library spur" },
  { ground: "path", area: [38, 14, 41, 17], note: "cottage spur" },
  { ground: "path", area: [41, 77, 44, 80], note: "community farm plot" },
];

/** Paint the ground map. */
export function townGround(): GroundMap {
  const cells = new Uint8Array(TOWN_W * TOWN_D);
  for (const { ground, area } of TOWN_GROUND) {
    const g = groundIndex(ground);
    for (let z = Math.max(0, area[1]); z < Math.min(TOWN_D, area[3]); z++) {
      for (let x = Math.max(0, area[0]); x < Math.min(TOWN_W, area[2]); x++) cells[z * TOWN_W + x] = g;
    }
  }
  return { w: TOWN_W, d: TOWN_D, cells };
}

// ---------------------------------------------------------------------------------------------
// Buildings

/** Difficulty leaves on a building's sign (GDD §4.1): 1 = beginner … 5 = advanced, 0 = no sign. */
export type Leaves = 0 | 1 | 2 | 3 | 4 | 5;

export interface TownBuilding extends TownPlacement {
  id: BuildingRecipeId;
  leaves: Leaves;
  /**
   * Where the free-standing difficulty sign stands, in the building frame [x, z]
   * (default: beside the door, 1 m out).
   */
  sign?: Vec2;
}

/**
 * Buildings face the road. West of the road they face east (rot 1), east of it west (rot 3);
 * the town hall faces the square (south, rot 0).
 */
export const TOWN_BUILDINGS: readonly TownBuilding[] = [
  { id: "apartment_block", at: [31, 92], rot: 1, leaves: 0 },
  { id: "bakery", at: [33, 79], rot: 1, leaves: 1 },
  { id: "farm", at: [41, 71], rot: 3, leaves: 1, sign: [4.2, 1.2] },
  { id: "general_store", at: [33, 66], rot: 1, leaves: 2 },
  { id: "clinic", at: [41, 61], rot: 3, leaves: 2, sign: [0.3, 1] },
  { id: "cafe", at: [26, 45], rot: 1, leaves: 3, sign: [4.2, 0.9] },
  { id: "gossip_house", at: [48, 44], rot: 3, leaves: 3 },
  { id: "town_hall", at: [27, 37], rot: 0, leaves: 4, sign: [5.4, 0.9] },
  { id: "library", at: [31, 17], rot: 1, leaves: 5 },
  { id: "elder_cottage", at: [41, 14], rot: 3, leaves: 5, sign: [0.3, 1] },
];

export function townBuilding(id: BuildingRecipeId): TownBuilding {
  const b = TOWN_BUILDINGS.find((x) => x.id === id);
  if (!b) throw new Error(`the town has no ${id}`);
  return b;
}

/** A building's footprint in the town frame. */
export function buildingArea(b: TownBuilding): Area {
  const { w, d } = buildingRecipe(b.id).footprint;
  return rectToTown(b, [0, -d, w, 0]);
}

export interface TownDoor {
  building: BuildingRecipeId;
  /** Threshold centre on the facade (the wall.door `door` socket) and the outward normal. */
  position: Vec2;
  normal: Vec2;
  /** Where you stand to use the door: half a metre out. */
  approach: Vec2;
}

/** Distance in front of a door where a walker stands to enter it. */
export const DOOR_APPROACH_M = 0.5;

/**
 * Ground-floor front doors of a building, from its recipe. The `door` socket of wall.door is the
 * centre of the module's facade, (0.5, 0, 0); a test checks this against the assembler.
 */
export function buildingDoors(b: TownBuilding): TownDoor[] {
  const recipe = buildingRecipe(b.id);
  const normal = rotateXZ(0, 1, b.rot);
  const doors: TownDoor[] = [];
  facadeRow(recipe, "front", 0).forEach((wall, slot) => {
    if (wall !== "wall.door") return;
    const position = toTown(b, [slot + 1.5, 0]);
    doors.push({
      building: b.id,
      position,
      normal,
      approach: [position[0] + normal[0] * DOOR_APPROACH_M, position[1] + normal[1] * DOOR_APPROACH_M],
    });
  });
  return doors;
}

export function townDoors(): TownDoor[] {
  return TOWN_BUILDINGS.flatMap(buildingDoors);
}

export interface DifficultySign {
  building: BuildingRecipeId;
  leaves: Exclude<Leaves, 0>;
  /** Foot of the post, and the direction the board faces (the building's front). */
  position: Vec2;
  rot: number;
}

/** Half-size of the area a difficulty sign post blocks. */
export const SIGN_POST_HALF_M = 0.2;

export function difficultySigns(): DifficultySign[] {
  const out: DifficultySign[] = [];
  for (const b of TOWN_BUILDINGS) {
    if (b.leaves === 0) continue;
    const slot = facadeRow(buildingRecipe(b.id), "front", 0).indexOf("wall.door");
    if (slot < 0) continue;
    const local: Vec2 = b.sign ?? [slot + 1.5 + 1.3, 1];
    out.push({ building: b.id, leaves: b.leaves, position: toTown(b, local), rot: b.rot });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Props

export interface TownProp extends TownPlacement {
  module: TownPropModuleId;
  /** Kit variant; omitted = picked from the position. */
  variant?: number;
}

/** A prop whose footprint centre is (cx, cz). */
function centred(module: TownPropModuleId, cx: number, cz: number, rot = 0, variant?: number): TownProp {
  const { w, d } = TOWN_PROPS[module];
  const [ox, oz] = rotateXZ(w / 2, -d / 2, rot);
  return { module, at: [cx - ox, cz - oz], rot, ...(variant === undefined ? {} : { variant }) };
}

const trees = (module: TownPropModuleId, spots: readonly Vec2[]) => spots.map(([x, z]) => centred(module, x, z));

export const TOWN_PROPS_LAYOUT: readonly TownProp[] = [
  // River crossing and fishing.
  { module: "bridge.stone", at: [35.5, 31.5], rot: 0 },
  { module: "dock.fishing", at: [54, 29.5], rot: 2 },
  // Town square: fountain, benches facing it, lamps, flower beds, the notice board, a stall.
  centred("fountain", 37, 46),
  centred("bench", 37, 40.5, 0),
  centred("bench", 37, 51.5, 2),
  centred("bench", 30.5, 46, 1),
  centred("bench", 43.5, 46, 3),
  centred("lamp", 33.5, 42.5),
  centred("lamp", 40.5, 42.5),
  centred("lamp", 33.5, 49.5),
  centred("lamp", 40.5, 49.5),
  centred("flowers", 36.5, 42.5, 0, 0),
  centred("flowers", 37.5, 42.5, 0, 0),
  centred("flowers", 36.5, 49.5, 0, 0),
  centred("flowers", 37.5, 49.5, 0, 0),
  centred("notice_board", 41, 37.7, 0),
  centred("market_stall", 41, 53, 2),
  centred("crate", 42.5, 53.5),
  centred("barrel", 42.5, 52.5),
  centred("basket", 39.5, 53.8),
  centred("tree.deciduous", 29, 52),
  centred("tree.deciduous", 45, 52),
  centred("tree.deciduous", 45, 40),
  // Street lamps along the road.
  centred("lamp", 34.5, 58.5),
  centred("lamp", 34.5, 82.5),
  centred("lamp", 38.5, 34.5),
  // Farm and bakery corners.
  centred("crate", 39.5, 76.5),
  centred("barrel", 40, 70),
  centred("basket", 33.6, 74),
  // West meadow.
  ...trees("tree.deciduous", [
    [6, 40],
    [16, 62],
    [8, 74],
    [19, 82],
    [10, 92],
  ]),
  ...trees("tree.cypress", [
    [24.5, 60.5],
    [25.5, 82.5],
    [24.5, 96.5],
  ]),
  // East side, towards the forest edge.
  ...trees("tree.conifer", [
    [57, 40],
    [60, 49],
    [53, 60],
    [60, 83],
    [55, 90],
    [60, 63],
  ]),
  centred("tree.deciduous", 50, 67),
  centred("tree.deciduous", 47, 86),
  // The hill across the river.
  ...trees("tree.conifer", [
    [5, 5],
    [21, 5],
    [49, 5],
    [57, 10],
    [60, 4],
    [52, 19],
    [59, 22],
    [9, 19],
    [19, 21],
  ]),
  ...trees("tree.cypress", [
    [25.5, 8.5],
    [45.5, 12.5],
  ]),
  ...[
    [11, 36],
    [20, 42],
    [53, 47],
    [14, 15],
    [44, 21],
  ].map(([x, z]) => centred("bush", x! + 0.5, z! + 0.5)),
  ...[
    [12, 55],
    [57, 56],
  ].map(([x, z]) => centred("flowers", x! + 0.5, z! + 0.5, 0, 0)),
  ...[
    [20, 33],
    [27, 25],
    [47, 25],
    [59, 36],
    [6, 24],
    [32, 8],
  ].map(([x, z]) => centred("rock", x! + 0.5, z! + 0.5)),
];

// ---------------------------------------------------------------------------------------------
// Spawn points, places and zones

/** Where players appear: in front of the apartment block door, first one = default. */
export const SPAWN_POINTS: readonly Vec2[] = [
  [33, 88.5],
  [33.5, 87.5],
  [33.5, 89.5],
  [34.5, 88.5],
  [34.5, 87.5],
  [34.5, 89.5],
];
export const SPAWN_POINT: Vec2 = SPAWN_POINTS[0]!;

/**
 * Standing points for every place NPC schedules and labels refer to (`PLACE_IDS`). Buildings use
 * their door's approach point; the rest are open ground next to the thing itself.
 */
export function townPlaces(): Readonly<Record<PlaceId, Vec2>> {
  const door = (id: BuildingRecipeId) => buildingDoors(townBuilding(id))[0]!.approach;
  return {
    apartment_block: door("apartment_block"),
    bakery: door("bakery"),
    farm: door("farm"),
    general_store: door("general_store"),
    clinic: door("clinic"),
    town_square: [37, 44],
    fountain: [37, 48.25],
    square_bench: [42.5, 46],
    notice_board: [41, 38.75],
    cafe: door("cafe"),
    gossip_house: door("gossip_house"),
    town_hall: door("town_hall"),
    bridge: [36.5, 29.5],
    fishing_dock: [53, 30.25],
    river_bank: [20.5, 32.75],
    library: door("library"),
    elder_cottage: door("elder_cottage"),
  };
}

/** Forage spawn zones (GDD §5.3) as areas in metres; spawns go on walkable cells inside them (TODO(M28)). */
export const FORAGE_ZONE_AREAS: Readonly<Record<ForageZone, readonly Area[]>> = {
  meadow: [[2, 34, 23, 98]],
  forest_edge: [[50, 34, 62, 98]],
  riverbank: [
    [1, 22, 63, 26],
    [1, 33, 63, 36],
  ],
  hill: [[1, 1, 63, 22]],
  square: [[26, 37, 48, 55]],
};

/** The camera and lighting centre for whole-town views, and the town bounds in metres. */
export const TOWN_CENTER: Vec2 = [TOWN_W / 2, TOWN_D / 2];
export const TOWN_BOUNDS: Area = [0.5, 0.5, TOWN_W - 0.5, TOWN_D - 0.5];
