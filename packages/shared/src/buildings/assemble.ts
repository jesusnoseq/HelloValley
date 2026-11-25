import { STOREY_M } from "../assets/kit";
import type { KitModule } from "../assets/kit";
import {
  CHIMNEY_MODULE_ID,
  CORNER_MODULE_ID,
  DORMER_MODULE_ID,
  type RecipeModuleId,
  type SignIcon,
  type WallModuleId,
} from "./modules";
import { type BuildingRecipe, type BuildingRecipeId, FACADE_SIDES, type FacadeSide, facadeRow, rotateXZ } from "./schema";

/**
 * The building assembler (GDD §7.2): turns a style-agnostic recipe into module placements on the
 * 1 m x 1 m x 3 m grid, in the building frame (see schema.ts). It is pure math: the client turns
 * the placements into merged meshes with whichever style kit is active, so switching the style
 * swaps the geometry without moving anything.
 */

export type Vec3 = [number, number, number];

export type PlacementRole = "wall" | "corner" | "roof" | "chimney" | "dormer" | "attachment" | "prop";

/**
 * One module instance. The transform applies, in the module's own frame, `scale` first, then
 * `rot` quarter turns about +Y (three.js `rotateY`), then the translation `position`:
 * world = position + rotY(rot, scale * local). Only roofs are scaled.
 */
export interface ModulePlacement {
  module: RecipeModuleId;
  variant: number;
  role: PlacementRole;
  position: Vec3;
  rot: number;
  scale: Vec3;
  /** Facade cell of walls, corners and attachments. */
  side?: FacadeSide;
  floor?: number;
  /** Shop icon of a `sign.hanging`. */
  icon?: SignIcon;
}

export interface BuildingDoor {
  side: FacadeSide;
  slot: number;
  /** The wall.door `door` socket (threshold centre on the facade) and its outward normal. */
  position: Vec3;
  normal: Vec3;
}

export interface AssembledBuilding {
  id: BuildingRecipeId;
  footprint: { w: number; d: number };
  floors: number;
  /** Height of the wall tops, where the roof starts. */
  eaveHeight: number;
  placements: ModulePlacement[];
  doors: BuildingDoor[];
  /** Union of the transformed manifest bounds of every placement. */
  bounds: { min: Vec3; max: Vec3 };
}

/** What the assembler needs from a kit manifest: every module's footprint, variants, bounds and sockets. */
export type AssemblerModule = Pick<KitModule, "id" | "footprint" | "variants" | "sockets" | "bounds">;
export interface AssemblerKit {
  modules: readonly AssemblerModule[];
}

const SIDE_TURNS: Record<FacadeSide, number> = { front: 0, right: 1, back: 2, left: 3 };

export function rotateVec(v: Vec3, quarterTurns: number): Vec3 {
  const [x, z] = rotateXZ(v[0], v[2], quarterTurns);
  return [x, v[1], z];
}

/** A point in a placed module's frame, in the building frame. */
export function transformPoint(p: Pick<ModulePlacement, "position" | "rot" | "scale">, local: readonly number[]): Vec3 {
  const scaled: Vec3 = [(local[0] ?? 0) * p.scale[0], (local[1] ?? 0) * p.scale[1], (local[2] ?? 0) * p.scale[2]];
  const r = rotateVec(scaled, p.rot);
  return [r[0] + p.position[0], r[1] + p.position[1], r[2] + p.position[2]];
}

/** The pivot of cell `t` of a side (counted left to right from outside) on storey `floor`. */
export function facadeCellOrigin(footprint: { w: number; d: number }, side: FacadeSide, t: number, floor: number): Vec3 {
  const y = floor * STOREY_M;
  switch (side) {
    case "front":
      return [t, y, 0];
    case "right":
      return [footprint.w, y, -t];
    case "back":
      return [footprint.w - t, y, -footprint.d];
    case "left":
      return [0, y, -footprint.d + t];
  }
}

function lookup(kit: AssemblerKit): (id: string) => AssemblerModule {
  const byId = new Map(kit.modules.map((m) => [m.id, m]));
  return (id) => {
    const m = byId.get(id);
    if (!m) throw new Error(`the kit has no module ${id}`);
    return m;
  };
}

function socket(module: AssemblerModule, name: string): Vec3 {
  const s = module.sockets.find((x) => x.name === name);
  if (!s) throw new Error(`${module.id} has no ${name} socket`);
  return [...s.pos];
}

/** A module whose pivot is placed so that its socket `local` lands on `target`. */
function mate(target: Vec3, local: Vec3, rot: number): Vec3 {
  const r = rotateVec(local, rot);
  return [target[0] - r[0], target[1] - r[1], target[2] - r[2]];
}

function boundsOf(placements: readonly ModulePlacement[], moduleOf: (id: string) => AssemblerModule): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of placements) {
    const { min: lo, max: hi } = moduleOf(p.module).bounds;
    for (let c = 0; c < 8; c++) {
      const corner = [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]];
      const w = transformPoint(p, corner);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i]!, w[i]!);
        max[i] = Math.max(max[i]!, w[i]!);
      }
    }
  }
  return { min, max };
}

/**
 * Place every module of a recipe. `kit` is the manifest of the style kit that will render it
 * (all style kits share footprints and sockets per module id, so any of them gives the same
 * shell); variants wrap when a kit has fewer than the recipe asks for.
 */
export function assembleBuilding(recipe: BuildingRecipe, kit: AssemblerKit): AssembledBuilding {
  const moduleOf = lookup(kit);
  const { footprint, floors } = recipe;
  const placements: ModulePlacement[] = [];
  const doors: BuildingDoor[] = [];
  const variantOf = (id: string, wanted: number | undefined) => (wanted ?? recipe.variant) % moduleOf(id).variants;
  const unit: Vec3 = [1, 1, 1];

  // Walls and corners, storey by storey.
  for (let floor = 0; floor < floors; floor++) {
    for (const side of FACADE_SIDES) {
      const rot = SIDE_TURNS[side];
      placements.push({
        module: CORNER_MODULE_ID,
        variant: variantOf(CORNER_MODULE_ID, undefined),
        role: "corner",
        position: facadeCellOrigin(footprint, side, 0, floor),
        rot,
        scale: unit,
        side,
        floor,
      });
      facadeRow(recipe, side, floor).forEach((wall: WallModuleId, slot) => {
        const placement: ModulePlacement = {
          module: wall,
          variant: variantOf(wall, undefined),
          role: "wall",
          position: facadeCellOrigin(footprint, side, slot + 1, floor),
          rot,
          scale: unit,
          side,
          floor,
        };
        placements.push(placement);
        if (wall === "wall.door" && floor === 0) {
          doors.push({ side, slot, position: transformPoint(placement, socket(moduleOf(wall), "door")), normal: rotateVec([0, 0, 1], rot) });
        }
      });
    }
  }

  // Attachments live one cell in front of their wall, in its storey frame.
  for (const a of recipe.attachments) {
    const rot = SIDE_TURNS[a.side];
    const wall = facadeCellOrigin(footprint, a.side, a.slot + 1, a.floor);
    const forward = rotateVec([0, 0, 1], rot);
    placements.push({
      module: a.module,
      variant: variantOf(a.module, a.variant),
      role: "attachment",
      position: [wall[0] + forward[0], wall[1], wall[2] + forward[2]],
      rot,
      scale: unit,
      side: a.side,
      floor: a.floor,
      ...(a.icon ? { icon: a.icon } : {}),
    });
  }

  // The roof: a 2 x 2 module scaled to the footprint. Along the ridge it stretches with the
  // footprint; across it, depth and height scale together so the pitch stays the same.
  const eaveHeight = floors * STOREY_M;
  const roofModule = moduleOf(recipe.roof.module);
  const rot = recipe.roof.ridge === "x" ? 0 : 1;
  const along = recipe.roof.ridge === "x" ? footprint.w : footprint.d;
  const across = recipe.roof.ridge === "x" ? footprint.d : footprint.w;
  const sx = along / roofModule.footprint.w;
  const sz = across / roofModule.footprint.d;
  const scale: Vec3 = [sx, sz, sz];
  // Put the turned, scaled footprint box exactly on [0, w] x [-d, 0].
  const corners = [
    [0, 0],
    [roofModule.footprint.w * sx, 0],
    [0, -roofModule.footprint.d * sz],
    [roofModule.footprint.w * sx, -roofModule.footprint.d * sz],
  ].map(([x, z]) => rotateXZ(x!, z!, rot));
  const minX = Math.min(...corners.map((c) => c[0]));
  const minZ = Math.min(...corners.map((c) => c[1]));
  const roof: ModulePlacement = {
    module: recipe.roof.module,
    variant: variantOf(recipe.roof.module, recipe.roof.variant),
    role: "roof",
    position: [0 - minX, eaveHeight, -footprint.d - minZ],
    rot,
    scale,
  };
  placements.push(roof);

  const roofVariant = recipe.roof.variant;
  if (recipe.roof.chimney) {
    const chimney = moduleOf(CHIMNEY_MODULE_ID);
    const target = transformPoint(roof, socket(roofModule, "chimney"));
    placements.push({
      module: CHIMNEY_MODULE_ID,
      variant: variantOf(CHIMNEY_MODULE_ID, roofVariant),
      role: "chimney",
      position: mate(target, socket(chimney, "base"), rot),
      rot,
      scale: unit,
    });
  }
  if (recipe.roof.dormers > 0) {
    const dormer = moduleOf(DORMER_MODULE_ID);
    const slot = socket(roofModule, "dormer");
    const mount = socket(dormer, "mount");
    for (let i = 0; i < recipe.roof.dormers; i++) {
      const u = (roofModule.footprint.w * (i + 0.5)) / recipe.roof.dormers;
      const target = transformPoint(roof, [u, slot[1], slot[2]]);
      placements.push({
        module: DORMER_MODULE_ID,
        variant: variantOf(DORMER_MODULE_ID, roofVariant),
        role: "dormer",
        position: mate(target, mount, rot),
        rot,
        scale: unit,
      });
    }
  }

  // Props stand on the ground around the building; `count` repeats along the turned +x.
  for (const p of recipe.props) {
    const width = moduleOf(p.module).footprint.w;
    for (let i = 0; i < p.count; i++) {
      const step = rotateVec([i * width, 0, 0], p.rot);
      placements.push({
        module: p.module,
        variant: variantOf(p.module, p.variant),
        role: "prop",
        position: [p.at[0] + step[0], 0, p.at[1] + step[2]],
        rot: p.rot,
        scale: unit,
      });
    }
  }

  return { id: recipe.id, footprint, floors, eaveHeight, placements, doors, bounds: boundsOf(placements, moduleOf) };
}
