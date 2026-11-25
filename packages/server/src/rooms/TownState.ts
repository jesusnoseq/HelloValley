import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Placeholder player entry. Positions are on the ground plane in metres.
 * TODO(M15/M16): animation state, appearance and facing; server-validated movement.
 */
export const TownPlayer = schema(
  {
    x: t.number(),
    z: t.number(),
  },
  "TownPlayer",
);
export type TownPlayer = SchemaType<typeof TownPlayer>;

/** Synced TownRoom state. TODO(M16): NPCs, world time, weather and spawns (architecture §7.1). */
export const TownState = schema(
  {
    players: t.map(TownPlayer),
  },
  "TownState",
);
export type TownState = SchemaType<typeof TownState>;
