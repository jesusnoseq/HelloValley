import type { StyleId } from "../data/styles";
import { dressTownProp } from "../world/dressing";
import { cellHash } from "../world/hash";
import { type FloorModuleId, interiorLayout } from "../world/interiors";
import type { Motion, SpaceId } from "../world/player";
import { TOWN_PROPS, type TownPropDef, type TownPropModuleId } from "../world/props";
import { type Ground, type GroundMap, groundAt } from "../world/terrain";
import { rectToTown, TOWN_PROPS_LAYOUT, townGround, type Vec2 } from "../world/town";
import { type FootstepClipId, footstepClipId, type Surface } from "./catalog";

/**
 * Footsteps by surface (GDD §11, build plan M35): what the player walks on, from the same data the
 * renderer and the walk grid use. In the town that is a deck when the player stands on one (the
 * bridge, the fishing dock) and otherwise the ground cell (terrain.ts); the bridge is stone in
 * most towns and wood in the Japanese one (its style dressing swaps the module). Interiors use
 * their floor module.
 */

const GROUND_SURFACE: Readonly<Record<Ground, Surface>> = {
  grass: "grass",
  path: "dirt",
  cobble: "cobble",
  sand: "sand",
  // Nobody walks on water except on a deck; a bank cell sounds like wet sand.
  water: "sand",
};

/** Decks you walk on, by the module the style shows. */
const DECK_SURFACE: Readonly<Partial<Record<TownPropModuleId, Surface>>> = {
  "bridge.stone": "stone",
  "bridge.wooden": "wood",
  "dock.fishing": "wood",
};

const FLOOR_SURFACE: Readonly<Record<FloorModuleId, Surface>> = {
  "floor.wood": "wood",
  "floor.tile": "tile",
  "floor.stone": "stone",
};

let ground: GroundMap | undefined;
const decks = TOWN_PROPS_LAYOUT.flatMap((prop) => {
  const walk = (TOWN_PROPS[prop.module] as TownPropDef).walk;
  return walk ? [{ prop, rect: rectToTown(prop, walk) }] : [];
});

export function surfaceAt(space: SpaceId, pos: Vec2, style: StyleId): Surface {
  if (space !== "town") return FLOOR_SURFACE[interiorLayout(space).floor.module];
  const [x, z] = pos;
  for (const { prop, rect } of decks) {
    if (x < rect[0] || x > rect[2] || z < rect[1] || z > rect[3]) continue;
    const shown = dressTownProp(prop, style);
    const surface = shown ? DECK_SURFACE[shown] : undefined;
    if (surface) return surface;
  }
  return GROUND_SURFACE[groundAt((ground ??= townGround()), x, z)];
}

/** Seconds between footsteps (small toy-like animals take quick steps). */
export const STEP_INTERVAL_SECONDS: Readonly<Record<Exclude<Motion, "idle">, number>> = { walk: 0.42, run: 0.29 };
/** Delay of the first step after starting to walk, so a short tap still sounds. */
export const FIRST_STEP_SECONDS = 0.1;

/**
 * Footstep timing: `update` returns the index of a step that lands this frame (or null). It
 * restarts when the walker stops, so the first step comes right after setting off.
 */
export class FootstepTimer {
  private left = FIRST_STEP_SECONDS;
  private count = 0;

  update(motion: Motion, dt: number): number | null {
    if (motion === "idle") {
      this.left = FIRST_STEP_SECONDS;
      return null;
    }
    this.left -= Math.max(0, dt);
    if (this.left > 0) return null;
    this.left = Math.max(this.left + STEP_INTERVAL_SECONDS[motion], STEP_INTERVAL_SECONDS[motion] * 0.5);
    return this.count++;
  }
}

export interface FootstepPlayback {
  clip: FootstepClipId;
  /** Playback rate (a small pitch spread so steps never sound machine-gunned). */
  rate: number;
  gain: number;
}

/** The clip, pitch and level of the `n`-th step on a surface. Running steps are a bit louder. */
export function footstepPlayback(surface: Surface, n: number, motion: Motion): FootstepPlayback {
  return {
    clip: footstepClipId(surface, n),
    rate: 0.93 + 0.14 * cellHash(n, 0, 11),
    gain: (0.82 + 0.18 * cellHash(n, 0, 23)) * (motion === "run" ? 1.15 : 1),
  };
}
