import { schema, t, type SchemaType } from "@colyseus/schema";
import type { TownPlayerView, TownWorldView } from "@hellovalley/shared";

/**
 * One player in a TownRoom shard (build plan M16). Positions are on the ground plane in metres,
 * in the player's current space (the town or an interior). `motion` drives remote avatars' clips
 * (the client runs the shared AnimationStateMachine; emotes arrive as messages). `appearance` is
 * the profile's `{animal, colors}` as JSON, refreshed when the mirror saves a new look.
 * The fields match the shared `TownPlayerView` (checked below).
 */
export const TownPlayer = schema(
  {
    name: t.string(),
    appearance: t.string(),
    space: t.string(),
    x: t.number(),
    z: t.number(),
    heading: t.number(),
    motion: t.string(),
    /** The NPC this player is talking to, or "" (build plan M23: bystanders see "chatting"). */
    talkingTo: t.string(),
    /** "" or "fishing" / "reeling" (build plan M27): remote avatars play the fishing clips. */
    activity: t.string(),
  },
  "TownPlayer",
);
export type TownPlayer = SchemaType<typeof TownPlayer>;

/**
 * The world clock and weather (GDD §4.3). The clock itself is wall time (shared world/clock.ts),
 * so the state only carries the server's time once a second; clients sync their clock with
 * `time:sync` probes and compute the phase every frame.
 */
export const TownWorld = schema(
  {
    serverTime: t.number(),
    day: t.number(),
    weather: t.string(),
    previousWeather: t.string(),
    weatherSince: t.number(),
  },
  "TownWorld",
);
export type TownWorld = SchemaType<typeof TownWorld>;

/**
 * Synced TownRoom state. NPCs stand at fixed posts for now (shared npcPosts.ts, build plan M23);
 * TODO(M31): NPC positions and schedule state. TODO(M28): forage spawns
 * (architecture §7.1). Fish shadows are private to the angler (`fish:cast`), not state.
 */
export const TownState = schema(
  {
    /** "Valley #n". */
    shard: t.number(),
    players: t.map(TownPlayer),
    world: TownWorld,
  },
  "TownState",
);
export type TownState = SchemaType<typeof TownState>;

// Compile-time check that the schemas carry every field the client reads (shared protocol types).
export type TownPlayerFieldsCheck = Pick<TownPlayer, keyof TownPlayerView>;
export type TownWorldFieldsCheck = Pick<TownWorld, keyof TownWorldView>;
