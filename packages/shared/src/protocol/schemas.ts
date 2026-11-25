import { z } from "zod";
import { EMOTE_KEYS } from "../avatar/animation";
import { NpcIdSchema } from "../data/npcs";
import { INTERIOR_IDS } from "../world/interiors";
import { ClientMessage } from "./messages";

/** Longest chat line a player can send, in characters (after trimming). */
export const CHAT_MAX_LENGTH = 200;
/** Sanity bound for world coordinates in metres (the town itself is TOWN_BOUNDS, world/town.ts). */
export const WORLD_COORD_LIMIT = 1000;
/** Headings are radians; anything beyond a few turns is garbage. */
export const HEADING_LIMIT = 8 * Math.PI;
/** Firebase ID tokens are JWTs of roughly 1 KB; anything far larger is rejected outright. */
export const ID_TOKEN_MAX_LENGTH = 4096;

// z.number() already rejects NaN and ±Infinity.
const coord = z.number().min(-WORLD_COORD_LIMIT).max(WORLD_COORD_LIMIT);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** Options passed to `client.joinOrCreate(RoomName.Town, options)`. */
export const JoinOptionsSchema = z.object({
  /** Firebase ID token of the signed-in player. TownRoom.onAuth verifies it with firebase-admin. */
  idToken: z.string().min(1).max(ID_TOKEN_MAX_LENGTH),
  // Joining a friend's shard: the client looks the shard up with GET /api/shards?friend=<uid>
  // and joins it by room id (`client.joinById`), with these same options.
});
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

/** The spaces a walker can be in: the town or one interior (world/player.ts `SpaceId`). */
export const SpaceIdSchema = z.enum(["town", ...INTERIOR_IDS]);

/**
 * `player:move` (build plan M16): where the client's predicted walker is. The server checks it
 * with `validateMove` (world/moveValidation.ts) and answers a rejection with a correction.
 */
export const PlayerMoveSchema = z.object({
  seq: z.number().int().min(0).max(2 ** 31),
  epoch: z.number().int().min(0).max(2 ** 31),
  space: SpaceIdSchema,
  x: coord,
  z: coord,
  heading: z.number().min(-HEADING_LIMIT).max(HEADING_LIMIT),
  motion: z.enum(["idle", "walk", "run"]),
});
export type PlayerMove = z.infer<typeof PlayerMoveSchema>;

/** `player:emote`: only the five hotbar emotes (keys 1–5) can be sent. */
export const EmoteRequestSchema = z.object({ emote: z.enum(EMOTE_KEYS) });

/** `time:sync`: the client's clock when it sent the probe. */
export const TimeSyncRequestSchema = z.object({ t: z.number() });

export const ChatMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(CHAT_MAX_LENGTH)
    .refine((t) => !CONTROL_CHARS.test(t), { message: "text must not contain control characters" }),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Lowercase slug ids such as `baker` or `notice_board`. */
export const EntityIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const InteractRequestSchema = z.discriminatedUnion("targetKind", [
  z.object({ targetKind: z.literal("npc"), targetId: NpcIdSchema }),
  // TODO(M26/M28): check object ids against the town's interactables (notice board, dock, shop
  // counters) and the live forage spawns; the static layout is world/town.ts.
  z.object({ targetKind: z.literal("object"), targetId: EntityIdSchema }),
]);
export type InteractRequest = z.infer<typeof InteractRequestSchema>;

/** Payload schema for every client → server message. */
export const ClientMessageSchemas = {
  [ClientMessage.PlayerMove]: PlayerMoveSchema,
  [ClientMessage.Emote]: EmoteRequestSchema,
  [ClientMessage.TimeSync]: TimeSyncRequestSchema,
  [ClientMessage.Chat]: ChatMessageSchema,
  [ClientMessage.Interact]: InteractRequestSchema,
} as const satisfies Record<ClientMessage, z.ZodType>;

export type ClientMessagePayloads = {
  [K in ClientMessage]: z.infer<(typeof ClientMessageSchemas)[K]>;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates a client → server payload. Never throws; invalid payloads come back as `ok: false`. */
export function parseClientMessage<K extends ClientMessage>(
  type: K,
  payload: unknown,
): ParseResult<ClientMessagePayloads[K]> {
  const result = ClientMessageSchemas[type].safeParse(payload);
  return result.success
    ? { ok: true, value: result.data as ClientMessagePayloads[K] }
    : { ok: false, error: z.prettifyError(result.error) };
}

/** Firebase uids are up to 128 characters of letters, digits and a few symbols. */
export const UidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** One TownRoom shard ("Valley #n") as `GET /api/shards` lists it. */
export const ShardInfoSchema = z.object({
  roomId: z.string().min(1),
  shard: z.number().int().min(1),
  clients: z.number().int().min(0),
  maxClients: z.number().int().min(1),
});
export type ShardInfo = z.infer<typeof ShardInfoSchema>;

/**
 * `GET /api/shards[?friend=<uid>]` (architecture §7.2): the open shards, plus the shard the
 * friend is playing in (null when they are offline or unknown).
 */
export const ShardsResponseSchema = z.object({
  shards: z.array(ShardInfoSchema),
  friend: ShardInfoSchema.nullable(),
});
export type ShardsResponse = z.infer<typeof ShardsResponseSchema>;
