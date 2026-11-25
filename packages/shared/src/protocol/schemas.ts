import { z } from "zod";
import { APARTMENT_MAX_PLACED } from "../apartment/layout";
import { EMOTE_KEYS } from "../avatar/animation";
import { FurnitureIdSchema, FurnitureRotationSchema } from "../firestore/schemas";
import { LanguageCodeSchema } from "../data/languages";
import { NpcIdSchema } from "../data/npcs";
import { ItemIdSchema } from "../data/items";
import { NpcActionListSchema } from "../npc/actions";
import { ConversationTelemetrySchema, NpcMemoryPayloadSchema } from "../npc/memory";
import { INTERIOR_IDS } from "../world/interiors";
import { CHAT_MAX_LENGTH, CHAT_REPORT_REASONS, ClientMessage } from "./messages";

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

/** `chat:send` (build plan M18): the line as typed, plus the language the sender says it is in. */
export const ChatMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(CHAT_MAX_LENGTH)
    .refine((t) => !CONTROL_CHARS.test(t), { message: "text must not contain control characters" }),
  lang: LanguageCodeSchema.optional(),
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

/** Firebase uids are up to 128 characters of letters, digits and a few symbols. */
export const UidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

/** Options passed to `client.joinOrCreate(RoomName.Apartment, options)` (build plan M17). */
export const ApartmentJoinOptionsSchema = JoinOptionsSchema.extend({
  /** Whose apartment: your own uid, or the host of an accepted visit. */
  owner: UidSchema,
});
export type ApartmentJoinOptions = z.infer<typeof ApartmentJoinOptionsSchema>;

/** Colyseus session ids are short random strings. */
const SessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const IntercomListSchema = z.strictObject({}).optional();
export const VisitRequestSchema = z.strictObject({ sessionId: SessionIdSchema });
export const VisitAnswerSchema = z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), accept: z.boolean() });

const roomCoord = z.number().min(0).max(12);
const editId = z.number().int().min(0).max(2 ** 31);
const pieceIndex = z.number().int().min(0).max(APARTMENT_MAX_PLACED - 1);

/** `furniture:edit`: one placement-mode action (the placement rules are apartment/layout.ts). */
export const FurnitureEditSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("move"), editId, index: pieceIndex, itemId: FurnitureIdSchema, x: roomCoord, z: roomCoord, rot: FurnitureRotationSchema }),
  z.strictObject({ op: z.literal("store"), editId, index: pieceIndex, itemId: FurnitureIdSchema }),
  z.strictObject({ op: z.literal("place"), editId, itemId: FurnitureIdSchema, x: roomCoord, z: roomCoord, rot: FurnitureRotationSchema }),
]);

/** Server-issued chat message ids (UUIDs). */
export const ChatMessageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const ChatMuteSchema = z.strictObject({ sessionId: SessionIdSchema, muted: z.boolean() });
export const ChatBlockSchema = z.strictObject({ sessionId: SessionIdSchema });
export const ChatUnblockSchema = z.strictObject({ uid: UidSchema });
export const ChatReportSchema = z.strictObject({
  sessionId: SessionIdSchema,
  messageId: ChatMessageIdSchema.optional(),
  reason: z.enum(CHAT_REPORT_REASONS),
});

/** Server-issued conversation, turn and trade ids (UUIDs). */
export const NpcTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** `npc:start` (build plan M21). The TownRoom checks the range against the NPC posts (M23); TODO(M31): live positions. */
export const NpcStartSchema = z.strictObject({ npcId: NpcIdSchema });
/** `npc:reply`: the actions are model output, parsed leniently (unknown ones dropped) and validated by the server. */
export const NpcReplySchema = z.strictObject({ conversationId: NpcTokenSchema, turnId: NpcTokenSchema, actions: NpcActionListSchema });
export const NpcConfirmSchema = z.strictObject({ conversationId: NpcTokenSchema, tradeId: NpcTokenSchema, accept: z.boolean() });
export const NpcEndSchema = z.strictObject({ conversationId: NpcTokenSchema });
/**
 * `npc:memory` (build plan M24): the compaction answer, through the same lenient zod schema the
 * client validated it with (it trims and clamps), plus bounded telemetry. The server sanitises again.
 */
export const NpcMemoryMessageSchema = NpcMemoryPayloadSchema.extend({
  conversationId: NpcTokenSchema,
  telemetry: ConversationTelemetrySchema,
});
/** `npc:gift`: any item id; the server checks it is giftable and held. */
export const NpcGiftSchema = z.strictObject({ conversationId: NpcTokenSchema, itemId: ItemIdSchema });

/** Payload schema for every client → server message. */
export const ClientMessageSchemas = {
  [ClientMessage.PlayerMove]: PlayerMoveSchema,
  [ClientMessage.Emote]: EmoteRequestSchema,
  [ClientMessage.TimeSync]: TimeSyncRequestSchema,
  [ClientMessage.Chat]: ChatMessageSchema,
  [ClientMessage.ChatMute]: ChatMuteSchema,
  [ClientMessage.ChatBlock]: ChatBlockSchema,
  [ClientMessage.ChatUnblock]: ChatUnblockSchema,
  [ClientMessage.ChatReport]: ChatReportSchema,
  [ClientMessage.Interact]: InteractRequestSchema,
  [ClientMessage.IntercomList]: IntercomListSchema,
  [ClientMessage.VisitRequest]: VisitRequestSchema,
  [ClientMessage.VisitAnswer]: VisitAnswerSchema,
  [ClientMessage.FurnitureEdit]: FurnitureEditSchema,
  [ClientMessage.NpcStart]: NpcStartSchema,
  [ClientMessage.NpcReply]: NpcReplySchema,
  [ClientMessage.NpcConfirm]: NpcConfirmSchema,
  [ClientMessage.NpcEnd]: NpcEndSchema,
  [ClientMessage.NpcMemory]: NpcMemoryMessageSchema,
  [ClientMessage.NpcGift]: NpcGiftSchema,
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
