import { schema, t, type SchemaType } from "@colyseus/schema";
import type { TownForageView, TownNpcView, TownPlayerView, TownWorldView } from "@hellovalley/shared";

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
    /** "" or "fishing" / "reeling" (build plan M27), "eating" (M29): remote avatars play those clips. */
    activity: t.string(),
    /** The seat (shared food/seats.ts id) the player sits on, or "" (build plan M29). */
    seat: t.string(),
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
 * One forage spawn or lost item lying in the town today (build plan M28), keyed by its spawn id
 * in `TownState.forage`. The set is the shared `dailySpawns(shard, day)`; picked ones leave the map.
 */
export const TownForageSpawn = schema(
  {
    itemId: t.string(),
    kind: t.string(),
    x: t.number(),
    z: t.number(),
  },
  "TownForageSpawn",
);
export type TownForageSpawn = SchemaType<typeof TownForageSpawn>;

/**
 * One villager (build plan M31), keyed by NPC id in `TownState.npcs`: where the server's NPC life
 * has it (rooms/npcLife.ts), whether it walks, and its activity clip.
 */
export const TownNpc = schema(
  {
    space: t.string(),
    x: t.number(),
    z: t.number(),
    heading: t.number(),
    motion: t.string(),
    activity: t.string(),
  },
  "TownNpc",
);
export type TownNpc = SchemaType<typeof TownNpc>;

/**
 * Synced TownRoom state. The villagers walk their schedules (build plan M31; at their posts when
 * the room runs without NPC life). The day's forage spawns are shared state (GDD §4.4, build plan
 * M28). Fish shadows are private to the angler (`fish:cast`), not state.
 */
export const TownState = schema(
  {
    /** "Valley #n". */
    shard: t.number(),
    players: t.map(TownPlayer),
    world: TownWorld,
    /** Spawn id → what lies there (build plan M28). */
    forage: t.map(TownForageSpawn),
    /** NPC id → where the villager is (build plan M31). */
    npcs: t.map(TownNpc),
  },
  "TownState",
);
export type TownState = SchemaType<typeof TownState>;

// Compile-time check that the schemas carry every field the client reads (shared protocol types).
export type TownPlayerFieldsCheck = Pick<TownPlayer, keyof TownPlayerView>;
export type TownWorldFieldsCheck = Pick<TownWorld, keyof TownWorldView>;
export type TownForageFieldsCheck = Pick<TownForageSpawn, keyof TownForageView>;
export type TownNpcFieldsCheck = Pick<TownNpc, keyof TownNpcView>;
