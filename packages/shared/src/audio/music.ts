import type { StyleId } from "../data/styles";
import { timeOfDayForMinutes } from "../world/clock";
import type { SpaceId } from "../world/player";
import { type MusicTrackId, type MusicVariant, musicTrackId } from "./catalog";

/**
 * Which music plays (GDD §11, build plan M35): one lo-fi acoustic loop per town style (accordion
 * and guitar for European, mandolin and guitar for Mediterranean, oud and qanun for Arabic, koto
 * and shakuhachi for Japanese), in a day and a night variant. The night variant runs in the
 * clock's "night" band (21:00–06:00, the same band fish tables and openers use), so it starts as
 * the sun goes down. Indoors the same loop plays a little softer, as if from a radio in the room.
 * The client crossfades whenever the chosen track changes (mix.ts `MUSIC_CROSSFADE_SECONDS`).
 */

export interface MusicContext {
  style: StyleId;
  /** In-game minutes since midnight (world/clock.ts). */
  minutes: number;
  space: SpaceId;
}

export interface MusicChoice {
  track: MusicTrackId;
  variant: MusicVariant;
  /** Track level on top of the music bus (1 outdoors). */
  gain: number;
}

/** Music level inside a building, relative to outdoors. */
export const MUSIC_INDOOR_GAIN = 0.75;

export function musicVariantAt(minutes: number): MusicVariant {
  return timeOfDayForMinutes(minutes) === "night" ? "night" : "day";
}

export function selectMusic({ style, minutes, space }: MusicContext): MusicChoice {
  const variant = musicVariantAt(minutes);
  return { track: musicTrackId(style, variant), variant, gain: space === "town" ? 1 : MUSIC_INDOOR_GAIN };
}
