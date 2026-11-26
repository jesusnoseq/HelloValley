import { facadeCellOrigin, rotateVec } from "../buildings/assemble";
import { buildingRecipe } from "../buildings/recipes";
import { type FacadeSide } from "../buildings/schema";
import { townPropBlocks, townPropFills } from "./dressing";
import { type Rect, TOWN_PROPS, type TownPropModuleId } from "./props";
import { groundIndex } from "./terrain";
import {
  type Area,
  buildingArea,
  composePlacement,
  difficultySigns,
  rectToTown,
  SIGN_POST_HALF_M,
  TOWN_BUILDINGS,
  TOWN_D,
  TOWN_PROPS_LAYOUT,
  TOWN_W,
  type TownPlacement,
  townGround,
  type Vec2,
} from "./town";

/**
 * The walkability grid (build plan M11): 0.5 m cells over the town, 1 = walkable. Built from the
 * ground map (water is not walkable, the bridge and dock decks are), building footprints, ground
 * floor flower boxes, recipe props, town props and the difficulty sign posts. The client uses it
 * for click-to-move and collisions (world/movement.ts); the server can build the same grid from shared
 * data for authoritative movement.
 */

export const NAV_CELL_M = 0.5;

export interface NavGrid {
  /** Cell size in metres. */
  cell: number;
  /** Size in cells; cell (i, j) covers [i * cell, (i + 1) * cell] x [j * cell, (j + 1) * cell]. */
  w: number;
  d: number;
  walk: Uint8Array;
}

export function createNavGrid(widthM: number, depthM: number, cell = NAV_CELL_M): NavGrid {
  const w = Math.round(widthM / cell);
  const d = Math.round(depthM / cell);
  return { cell, w, d, walk: new Uint8Array(w * d) };
}

export function navIndex(grid: NavGrid, i: number, j: number): number {
  return j * grid.w + i;
}

export function inGrid(grid: NavGrid, i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < grid.w && j < grid.d;
}

export function isWalkableCell(grid: NavGrid, i: number, j: number): boolean {
  return inGrid(grid, i, j) && grid.walk[navIndex(grid, i, j)] === 1;
}

/** The cell that holds a point in metres. */
export function cellOf(grid: NavGrid, p: Vec2): [number, number] {
  return [Math.floor(p[0] / grid.cell), Math.floor(p[1] / grid.cell)];
}

export function cellCentre(grid: NavGrid, i: number, j: number): Vec2 {
  return [(i + 0.5) * grid.cell, (j + 0.5) * grid.cell];
}

export function isWalkable(grid: NavGrid, p: Vec2): boolean {
  const [i, j] = cellOf(grid, p);
  return isWalkableCell(grid, i, j);
}

const EPS = 1e-6;

/** Set every cell that overlaps `r` (blocking: anything touching the area is out). */
export function fillOverlapping(grid: NavGrid, r: Rect, value: 0 | 1): void {
  const i0 = Math.max(0, Math.floor((r[0] + EPS) / grid.cell));
  const j0 = Math.max(0, Math.floor((r[1] + EPS) / grid.cell));
  const i1 = Math.min(grid.w, Math.ceil((r[2] - EPS) / grid.cell));
  const j1 = Math.min(grid.d, Math.ceil((r[3] - EPS) / grid.cell));
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) grid.walk[navIndex(grid, i, j)] = value;
}

/** Set every cell whose centre lies inside `r` (decks: only cells fully on them). */
export function fillCentres(grid: NavGrid, r: Rect, value: 0 | 1): void {
  const i0 = Math.max(0, Math.ceil(r[0] / grid.cell - 0.5));
  const j0 = Math.max(0, Math.ceil(r[1] / grid.cell - 0.5));
  const i1 = Math.min(grid.w - 1, Math.floor(r[2] / grid.cell - 0.5));
  const j1 = Math.min(grid.d - 1, Math.floor(r[3] / grid.cell - 0.5));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid.walk[navIndex(grid, i, j)] = value;
}

const SIDE_TURNS: Record<FacadeSide, number> = { front: 0, right: 1, back: 2, left: 3 };
/** Ground-floor flower boxes stick 0.32 m out of the wall (europe kit bounds). */
const FLOWERBOX_RECT: Rect = [0.15, -1, 0.85, -0.68];

export interface Blocker {
  kind: "building" | "flowerbox" | "recipe_prop" | "prop" | "sign";
  /** Building id or prop module. */
  source: string;
  area: Area;
}

function propBlock(module: TownPropModuleId): Rect | undefined {
  const def = TOWN_PROPS[module] as { blocks?: Rect };
  return def.blocks;
}

/** Every area that blocks walking, in the town frame. */
export function townBlockers(): Blocker[] {
  const out: Blocker[] = [];
  for (const b of TOWN_BUILDINGS) {
    out.push({ kind: "building", source: b.id, area: buildingArea(b) });
    const recipe = buildingRecipe(b.id);
    for (const a of recipe.attachments) {
      if (a.module !== "flowerbox" || a.floor !== 0) continue;
      const wall = facadeCellOrigin(recipe.footprint, a.side, a.slot + 1, 0);
      const forward = rotateVec([0, 0, 1], SIDE_TURNS[a.side]);
      const inner: TownPlacement = { at: [wall[0] + forward[0], wall[2] + forward[2]], rot: SIDE_TURNS[a.side] };
      out.push({ kind: "flowerbox", source: b.id, area: rectToTown(composePlacement(b, inner), FLOWERBOX_RECT) });
    }
    for (const p of recipe.props) {
      const blocks = propBlock(p.module);
      if (!blocks) continue;
      const width = TOWN_PROPS[p.module].w;
      for (let k = 0; k < p.count; k++) {
        const step = rotateVec([k * width, 0, 0], p.rot);
        const inner: TownPlacement = { at: [p.at[0] + step[0], p.at[1] + step[2]], rot: p.rot };
        out.push({ kind: "recipe_prop", source: p.module, area: rectToTown(composePlacement(b, inner), blocks) });
      }
    }
  }
  // A prop blocks what any of its per-style fills blocks (dressing.ts), so walking is the same
  // in every style.
  for (const p of TOWN_PROPS_LAYOUT) {
    for (const blocks of townPropBlocks(p)) out.push({ kind: "prop", source: p.module, area: rectToTown(p, blocks) });
  }
  for (const s of difficultySigns()) {
    const h = SIGN_POST_HALF_M;
    out.push({ kind: "sign", source: s.building, area: [s.position[0] - h, s.position[1] - h, s.position[0] + h, s.position[1] + h] });
  }
  return out;
}

/** Decks over water you can walk on (bridge, dock), in the town frame. */
export function townDecks(): Area[] {
  const out: Area[] = [];
  for (const p of TOWN_PROPS_LAYOUT) {
    // Every fill of a deck keeps the neutral deck (bridge.wooden = bridge.stone; a test checks it).
    const walk = townPropFills(p)
      .map((m) => (TOWN_PROPS[m] as { walk?: Rect }).walk)
      .find((w) => w !== undefined);
    if (walk) out.push(rectToTown(p, walk));
  }
  return out;
}

/** Build the town's walkability grid. */
export function buildTownNavGrid(cell = NAV_CELL_M): NavGrid {
  const grid = createNavGrid(TOWN_W, TOWN_D, cell);
  const ground = townGround();
  const water = groundIndex("water");
  // Ground: everything but water, inside a 1 m border (the edge of the diorama).
  for (let j = 0; j < grid.d; j++) {
    for (let i = 0; i < grid.w; i++) {
      const [x, z] = cellCentre(grid, i, j);
      const gx = Math.floor(x);
      const gz = Math.floor(z);
      const inside = gx >= 1 && gz >= 1 && gx < TOWN_W - 1 && gz < TOWN_D - 1;
      grid.walk[navIndex(grid, i, j)] = inside && ground.cells[gz * TOWN_W + gx] !== water ? 1 : 0;
    }
  }
  for (const deck of townDecks()) fillCentres(grid, deck, 1);
  for (const b of townBlockers()) fillOverlapping(grid, b.area, 0);
  return grid;
}

let cached: NavGrid | undefined;

/** The town grid, built once. Treat it as read-only. */
export function townNavGrid(): NavGrid {
  return (cached ??= buildTownNavGrid());
}
