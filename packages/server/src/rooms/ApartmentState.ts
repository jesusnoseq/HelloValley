import { schema, t, type SchemaType } from "@colyseus/schema";
import type { ApartmentOccupantView, ApartmentStateView } from "@hellovalley/shared";

/** One person in an apartment (the owner or a visitor), keyed by ApartmentRoom session id. */
export const ApartmentOccupant = schema(
  {
    name: t.string(),
    /** Their TownRoom session id; positions are in the TownRoom state. */
    townSession: t.string(),
    owner: t.boolean(),
  },
  "ApartmentOccupant",
);
export type ApartmentOccupant = SchemaType<typeof ApartmentOccupant>;

/**
 * Synced ApartmentRoom state (build plan M17). The layout is the shared `ApartmentLayoutData` as
 * JSON (at most 40 placed pieces, well under 4 KB) and is replaced whole on every accepted edit;
 * `revision` counts the edits so clients can tell a new layout from a resend.
 */
export const ApartmentState = schema(
  {
    owner: t.string(),
    ownerName: t.string(),
    apartmentId: t.string(),
    layout: t.string(),
    revision: t.number(),
    occupants: t.map(ApartmentOccupant),
  },
  "ApartmentState",
);
export type ApartmentState = SchemaType<typeof ApartmentState>;

// Compile-time check that the schemas carry every field the client reads (shared protocol types).
export type ApartmentStateFieldsCheck = Pick<ApartmentState, keyof ApartmentStateView>;
export type ApartmentOccupantFieldsCheck = Pick<ApartmentOccupant, keyof ApartmentOccupantView>;
