import { STOREY_M } from "../assets/kit";
import { buildingRecipe } from "../buildings/recipes";
import type { Vec3 } from "../buildings/assemble";
import type { BuildingRecipeId } from "../buildings/schema";
import {
  buildingForInterior,
  doorTriggerArea,
  type InteriorId,
  interiorEntrance,
  interiorForBuilding,
  interiorLayout,
  interiorNavGrid,
  isInteriorId,
} from "./interiors";
import {
  clampDirection,
  followPath,
  headingFor,
  moveWithCollisions,
  type PathFollow,
  planPath,
  RUN_SPEED_MPS,
  WALK_SPEED_MPS,
} from "./movement";
import type { NavGrid } from "./navgrid";
import { townNavGrid } from "./navgrid";
import { type Area, buildingArea, buildingDoors, DOOR_APPROACH_M, TOWN_BUILDINGS, townBuilding, type Vec2 } from "./town";

/**
 * The local player controller (build plan M13): one walker in one space (the town or an
 * interior), moved by WASD directions or click-to-move paths, that goes through doors. Pure and
 * deterministic, so a test can walk it everywhere. Online (build plan M16) the client predicts
 * with it and reports positions, which the TownRoom validates (moveValidation.ts).
 */

export type SpaceId = "town" | InteriorId;

export function isSpaceId(value: unknown): value is SpaceId {
  return value === "town" || isInteriorId(value);
}

/**
 * Spaces other players never see you in: your apartment is your own private instance (GDD §4.2).
 * The ApartmentRoom (build plan M17) hosts its furniture and visits; the TownRoom shows players
 * in an apartment only to the others in that same apartment.
 */
export function isPrivateSpace(space: SpaceId): boolean {
  return space === "apartment";
}

export function spaceGrid(space: SpaceId): NavGrid {
  return space === "town" ? townNavGrid() : interiorNavGrid(space);
}

/**
 * The walkability grid of each space. The default is the static town and interior grids; the
 * apartment's grid depends on its owner's furniture layout (build plan M17), so the controller
 * and the move validation take a lookup.
 */
export type SpaceGrids = (space: SpaceId) => NavGrid;

export interface SpacePoint {
  space: SpaceId;
  pos: Vec2;
  heading: number;
}

/** A door you can walk through: its trigger zone in `space` and where it leads. */
export interface DoorLink {
  id: string;
  space: SpaceId;
  /** Doorway centre and the unit direction you walk to go through it. */
  centre: Vec2;
  toward: Vec2;
  trigger: Area;
  /** Clicking inside this area (a box up to `clickHeight` metres) walks to the door and through it. */
  clickArea: Area;
  clickHeight: number;
  to: SpacePoint;
}

/** Where you appear outside a building after leaving it: this far out from the threshold. */
export const DOOR_EXIT_M = DOOR_APPROACH_M + 0.3;
/** Pushing towards a door must be at least this aligned with it (cosine). */
export const DOOR_INTENT_MIN = 0.3;

function grow(a: Area, m: number): Area {
  return [a[0] - m, a[1] - m, a[2] + m, a[3] + m];
}

const inside = (p: Vec2, a: Area) => p[0] >= a[0] && p[0] <= a[2] && p[1] >= a[1] && p[1] <= a[3];

/** Where you stand in town after coming out of a building (its first front door). */
export function buildingExitPoint(id: BuildingRecipeId): SpacePoint {
  const door = buildingDoors(townBuilding(id))[0]!;
  return {
    space: "town",
    pos: [door.position[0] + door.normal[0] * DOOR_EXIT_M, door.position[1] + door.normal[1] * DOOR_EXIT_M],
    heading: headingFor(door.normal),
  };
}

/** Where you stand inside an interior after coming in. */
export function interiorArrivalPoint(id: InteriorId): SpacePoint {
  const e = interiorEntrance(interiorLayout(id));
  return { space: id, pos: e.arrival, heading: headingFor(e.inward) };
}

let townLinks: DoorLink[] | undefined;

/** The doors of a space: every building front door in town, the entrance inside an interior. */
export function spaceDoors(space: SpaceId): readonly DoorLink[] {
  if (space === "town") {
    townLinks ??= TOWN_BUILDINGS.flatMap((b) =>
      buildingDoors(b).map((door, k) => {
        const toward: Vec2 = [-door.normal[0], -door.normal[1]];
        return {
          id: `${b.id}:${k}`,
          space: "town" as const,
          centre: door.position,
          toward,
          trigger: doorTriggerArea(door.position, door.normal),
          clickArea: buildingArea(b),
          // Storeys plus most of the roof.
          clickHeight: buildingRecipe(b.id).floors * STOREY_M + 2,
          to: interiorArrivalPoint(interiorForBuilding(b.id)),
        };
      }),
    );
    return townLinks;
  }
  const e = interiorEntrance(interiorLayout(space));
  const toward: Vec2 = [-e.inward[0], -e.inward[1]];
  return [
    {
      id: `${space}:exit`,
      space,
      centre: e.position,
      toward,
      trigger: e.trigger,
      // The doorway itself and anything beyond it.
      clickArea: grow([e.position[0], e.position[1], e.position[0], e.position[1]], 0.8),
      clickHeight: 2.4,
      to: buildingExitPoint(buildingForInterior(space)),
    },
  ];
}

/** Where a ray (origin, direction) first meets an axis-aligned box, as the distance along it, or null. */
export function rayBox(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): number | null {
  let t0 = 0;
  let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const o = origin[k]!;
    const d = dir[k]!;
    if (Math.abs(d) < 1e-12) {
      if (o < min[k]! || o > max[k]!) return null;
      continue;
    }
    let a = (min[k]! - o) / d;
    let b = (max[k]! - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

export interface ClickPick {
  /** The ground point under the click (y = 0), or the door's centre when a door's box was hit. */
  point: Vec2;
  door: DoorLink | null;
}

/**
 * What a click ray hits in a space: the nearest door click box (a building's walls and roof in
 * town, the doorway indoors), else the ground plane. A click on a tall wall would otherwise land
 * on the ground far behind the building.
 */
export function pickClick(space: SpaceId, origin: Vec3, dir: Vec3): ClickPick | null {
  let best: { t: number; door: DoorLink } | null = null;
  for (const door of spaceDoors(space)) {
    const [x0, z0, x1, z1] = door.clickArea;
    const t = rayBox(origin, dir, [x0, 0, z0], [x1, door.clickHeight, z1]);
    if (t !== null && (!best || t < best.t)) best = { t, door };
  }
  if (best) return { point: [best.door.centre[0], best.door.centre[1]], door: best.door };
  if (dir[1] >= -1e-9) return null;
  const t = -origin[1] / dir[1];
  return { point: [origin[0] + dir[0] * t, origin[2] + dir[2] * t], door: null };
}

export type Motion = "idle" | "walk" | "run";

export interface PlayerState extends SpacePoint {
  motion: Motion;
}

/** Seconds to keep pushing into a clicked door after the path ends before giving up. */
const DOOR_PUSH_S = 1;

/**
 * One walker. Call `setInput` (WASD) or `clickTo`, then `update(dt)` each frame. When it walks
 * into a door, `update` returns that door and the walker freezes until `completeTransition()`
 * (the client fades out first) moves it to the other side.
 */
export class PlayerController {
  state: PlayerState;
  private input: Vec2 = [0, 0];
  private running = false;
  private path: PathFollow | null = null;
  private pathDoor: DoorLink | null = null;
  private pushTime = 0;
  private pending: DoorLink | null = null;

  constructor(
    start: SpacePoint,
    /** Walkability per space (the apartment's follows its furniture layout). */
    readonly grids: SpaceGrids = spaceGrid,
  ) {
    this.state = { ...start, pos: [start.pos[0], start.pos[1]], motion: "idle" };
  }

  /** The door being walked through (between `update` returning it and `completeTransition`). */
  get transition(): DoorLink | null {
    return this.pending;
  }

  /** The current click-to-move waypoints (for a path marker), or null. */
  get waypoints(): readonly Vec2[] | null {
    return this.path ? this.path.points.slice(this.path.index) : null;
  }

  /** WASD / arrows: a world-space direction (length ≤ 1; zero = none). Any input cancels a path. */
  setInput(dir: Vec2, run = false): void {
    this.input = clampDirection(dir);
    this.running = run;
    if (dir[0] !== 0 || dir[1] !== 0) {
      this.path = null;
      this.pathDoor = null;
    }
  }

  /** Click-to-move. Clicking a building (or a door) walks to its door and through it. Returns false when unreachable. */
  clickTo(target: Vec2): boolean {
    if (this.pending) return false;
    const grid = this.grids(this.state.space);
    const door = spaceDoors(this.state.space).find((d) => inside(target, d.clickArea)) ?? null;
    // Aim for the middle of the door's trigger zone.
    const goal: Vec2 = door
      ? [(door.trigger[0] + door.trigger[2]) / 2 - door.toward[0] * 0.05, (door.trigger[1] + door.trigger[3]) / 2 - door.toward[1] * 0.05]
      : target;
    const points = planPath(grid, this.state.pos, goal);
    if (!points) return false;
    this.path = { points, index: 0, stuck: 0 };
    this.pathDoor = door;
    this.pushTime = 0;
    return true;
  }

  /** Click-to-move from a camera ray (see `pickClick`). Returns false when nothing reachable was hit. */
  clickRay(origin: Vec3, dir: Vec3): boolean {
    const pick = pickClick(this.state.space, origin, dir);
    return pick ? this.clickTo(pick.point) : false;
  }

  /** Put the walker somewhere (spawn, server correction). Cancels paths and transitions. */
  teleport(point: SpacePoint): void {
    this.state = { ...point, pos: [point.pos[0], point.pos[1]], motion: "idle" };
    this.path = null;
    this.pathDoor = null;
    this.pending = null;
  }

  /** Move to the other side of the pending door. */
  completeTransition(): SpacePoint | null {
    const door = this.pending;
    if (!door) return null;
    this.teleport(door.to);
    return door.to;
  }

  /** Advance `dt` seconds. Returns a door when the walker has just walked into one. */
  update(dt: number): DoorLink | null {
    if (this.pending) return null;
    const grid = this.grids(this.state.space);
    const speed = this.running ? RUN_SPEED_MPS : WALK_SPEED_MPS;
    let intent: Vec2 = [0, 0];
    let candidates: readonly DoorLink[] = spaceDoors(this.state.space);

    if (this.input[0] !== 0 || this.input[1] !== 0) {
      intent = this.input;
      const mag = Math.hypot(intent[0], intent[1]);
      this.state.pos = moveWithCollisions(grid, this.state.pos, [intent[0] * speed * dt, intent[1] * speed * dt]);
      this.state.motion = this.running && mag > 0.5 ? "run" : "walk";
    } else if (this.path) {
      // Doors only fire for the door a path was aimed at, not ones it passes.
      candidates = this.pathDoor ? [this.pathDoor] : [];
      const r = followPath(grid, this.state.pos, this.path, speed, dt);
      this.state.pos = r.pos;
      intent = r.dir;
      this.state.motion = r.done ? "idle" : this.running ? "run" : "walk";
      if (r.done || r.stuck) {
        this.path = null;
        if (!this.pathDoor) this.state.motion = "idle";
      }
    } else if (this.pathDoor) {
      // The path ended next to the clicked door: keep walking into it for a moment.
      const door = this.pathDoor;
      candidates = [door];
      intent = door.toward;
      this.state.pos = moveWithCollisions(grid, this.state.pos, [intent[0] * speed * dt, intent[1] * speed * dt]);
      this.state.motion = this.running ? "run" : "walk";
      this.pushTime += dt;
      if (this.pushTime > DOOR_PUSH_S) {
        this.pathDoor = null;
        this.state.motion = "idle";
      }
    } else {
      this.state.motion = "idle";
    }

    if (intent[0] !== 0 || intent[1] !== 0) this.state.heading = headingFor(intent);
    const len = Math.hypot(intent[0], intent[1]);
    if (len > 1e-6) {
      for (const door of candidates) {
        const along = (intent[0] * door.toward[0] + intent[1] * door.toward[1]) / len;
        if (along >= DOOR_INTENT_MIN && inside(this.state.pos, door.trigger)) {
          this.pending = door;
          this.path = null;
          this.pathDoor = null;
          this.state.motion = "idle";
          return door;
        }
      }
    }
    return null;
  }
}
