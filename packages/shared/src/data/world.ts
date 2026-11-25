import { z } from "zod";

/**
 * Time-of-day bands used by fish tables, NPC openers and barks. The world clock that maps the
 * server time to a band (1 in-game day = 40 real minutes, GDD §4.3) arrives with TODO(M16).
 */
export const TIMES_OF_DAY = ["morning", "afternoon", "evening", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
export const TimeOfDaySchema = z.enum(TIMES_OF_DAY);

/** Cosmetic weather (GDD §4.3). It also changes which fish bite. */
export const WEATHERS = ["sun", "rain", "fog"] as const;
export type Weather = (typeof WEATHERS)[number];
export const WeatherSchema = z.enum(WEATHERS);

export const MINUTES_PER_DAY = 24 * 60;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since in-game midnight for an `HH:MM` (24 h) clock time, or undefined if malformed. */
export function clockToMinutes(time: string): number | undefined {
  const match = CLOCK.exec(time);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Places in the town that schedules, spawns and labels refer to (GDD §4.1). Positions come with the
 * town layout in TODO(M11).
 */
export const PLACE_IDS = [
  "apartment_block",
  "bakery",
  "farm",
  "general_store",
  "clinic",
  "town_square",
  "fountain",
  "square_bench",
  "notice_board",
  "cafe",
  "gossip_house",
  "town_hall",
  "bridge",
  "fishing_dock",
  "river_bank",
  "library",
  "elder_cottage",
] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

/** Buildings with an NPC in charge, plus the two residents' houses. */
export const BUILDING_IDS = [
  "bakery",
  "farm",
  "general_store",
  "clinic",
  "cafe",
  "town_hall",
  "library",
  "gossip_house",
  "elder_cottage",
] as const satisfies readonly PlaceId[];
export type BuildingId = (typeof BUILDING_IDS)[number];
