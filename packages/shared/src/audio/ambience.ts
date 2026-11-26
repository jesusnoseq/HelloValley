import { SUNRISE_MINUTES, SUNSET_MINUTES } from "../world/clock";
import { buildingForInterior, type InteriorId } from "../world/interiors";
import type { SpaceId } from "../world/player";
import { type Area, buildingDoors, TOWN_GROUND, townBuilding, type Vec2 } from "../world/town";
import { AMBIENT_LAYERS, type AmbientLayer } from "./catalog";
import { smoothstep } from "./mix";

/**
 * Ambient layers by place and time (GDD §11, build plan M35): the river near the water, birds by
 * day (a dawn chorus in the early morning), crickets by night, distant chatter around the town
 * square while the town is awake, and rain in rainy weather. Each layer gets a target level 0–1;
 * the client eases every looping layer towards it (mix.ts `AMBIENCE_TAU_SECONDS`).
 *
 * Indoors the outdoor layers are heard muffled, as they sound at the building's front door (the
 * gossip's house on the square still hears the square, the elder's cottage on the hill does not);
 * rain drums on the roof, and the busy shops and the café have their own chatter.
 */

export type AmbienceLevels = Record<AmbientLayer, number>;

export interface AmbienceContext {
  space: SpaceId;
  /** Position in the space's frame (town metres, or the interior's floor). */
  pos: Vec2;
  /** In-game minutes since midnight. */
  minutes: number;
  /** Share of rain in the current weather, 0–1 (weather.ts weights). */
  rain: number;
}

/** Ramp half-width around sunrise and sunset (in-game minutes). */
const TWILIGHT_HALF_MINUTES = 40;
/** River: full within this distance of the water (m), silent beyond `RIVER_FAR_M`. */
export const RIVER_NEAR_M = 1.5;
export const RIVER_FAR_M = 20;
/** Square chatter: full on the square, silent this far from it (m). */
export const CHATTER_FAR_M = 18;
/** Outdoor layers heard through a building's walls. */
export const INDOOR_MUFFLE = 0.2;
/** Rain on the roof, relative to outdoors. */
export const INDOOR_RAIN = 0.35;
/** Chatter of customers inside the busier rooms (times the town's activity). */
export const INDOOR_CHATTER: Readonly<Partial<Record<InteriorId, number>>> = {
  cafe: 0.6,
  bakery: 0.3,
  general_store: 0.25,
  town_hall: 0.2,
};

/** The town square's cobbles (town.ts TOWN_GROUND "town square"). */
export const SQUARE_AREA: Area = [26, 37, 48, 55];
const RIVER_AREAS: readonly Area[] = TOWN_GROUND.filter((g) => g.ground === "water").map((g) => g.area);

/** Distance (m) from a point to an area, 0 inside it. */
export function distanceToArea([x, z]: Vec2, [x0, z0, x1, z1]: Area): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

export function distanceToRiver(pos: Vec2): number {
  return Math.min(...RIVER_AREAS.map((a) => distanceToArea(pos, a)));
}

const wrapMinutes = (m: number) => (((m % 1440) + 1440) % 1440 || 0);

/** How much daylight there is (0 at night, 1 by day), easing through dawn and dusk. */
export function daylightAt(minutes: number): number {
  const m = wrapMinutes(minutes);
  const rise = smoothstep(SUNRISE_MINUTES - TWILIGHT_HALF_MINUTES, SUNRISE_MINUTES + TWILIGHT_HALF_MINUTES, m);
  const set = smoothstep(SUNSET_MINUTES - TWILIGHT_HALF_MINUTES, SUNSET_MINUTES + TWILIGHT_HALF_MINUTES, m);
  return rise * (1 - set);
}

/** The dawn chorus: birds are loudest for the first two hours after sunrise. */
function dawnChorus(m: number): number {
  return smoothstep(SUNRISE_MINUTES - 30, SUNRISE_MINUTES + 30, m) * (1 - smoothstep(7.5 * 60, 9 * 60, m));
}

/** How busy the town is (people about): 08:00–20:00, quiet at night. */
export function townActivityAt(minutes: number): number {
  const m = wrapMinutes(minutes);
  return smoothstep(7 * 60, 8.5 * 60, m) * (1 - smoothstep(20 * 60, 21.5 * 60, m));
}

const doorPoints = new Map<InteriorId, Vec2>();
/** Where an interior's sounds from outside come from: its building's front door in the town. */
export function interiorTownPoint(id: InteriorId): Vec2 {
  let p = doorPoints.get(id);
  if (!p) {
    const door = buildingDoors(townBuilding(buildingForInterior(id)))[0];
    p = door ? door.position : townBuilding(buildingForInterior(id)).at;
    doorPoints.set(id, p);
  }
  return p;
}

function outdoorLevels(pos: Vec2, m: number, rain: number): AmbienceLevels {
  const day = daylightAt(m);
  const wet = Math.min(1, Math.max(0, rain));
  return {
    river: 1 - smoothstep(RIVER_NEAR_M, RIVER_FAR_M, distanceToRiver(pos)),
    birds: Math.min(1, day * 0.7 + 0.3 * dawnChorus(m)) * (1 - 0.75 * wet),
    crickets: (1 - day) * (1 - 0.7 * wet),
    chatter: (1 - smoothstep(0, CHATTER_FAR_M, distanceToArea(pos, SQUARE_AREA))) * townActivityAt(m) * (1 - 0.5 * wet),
    rain: wet,
  };
}

/** The target level of every ambient layer for where the player is, the time and the weather. */
export function ambienceLevels({ space, pos, minutes, rain }: AmbienceContext): AmbienceLevels {
  const m = wrapMinutes(minutes);
  if (space === "town") return outdoorLevels(pos, m, rain);
  const outside = outdoorLevels(interiorTownPoint(space), m, rain);
  const levels = Object.fromEntries(AMBIENT_LAYERS.map((l) => [l, outside[l] * INDOOR_MUFFLE])) as AmbienceLevels;
  levels.rain = outside.rain * INDOOR_RAIN;
  levels.chatter = Math.max(levels.chatter, (INDOOR_CHATTER[space] ?? 0) * townActivityAt(m));
  return levels;
}
