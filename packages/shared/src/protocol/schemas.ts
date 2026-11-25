import { z } from "zod";
import { NpcIdSchema } from "../data/npcs";
import { ClientMessage } from "./messages";

/** Longest chat line a player can send, in characters (after trimming). */
export const CHAT_MAX_LENGTH = 200;
/**
 * Sanity bound for world coordinates in metres. The real town bounds come with the town layout.
 * TODO(M11): validate click targets against the town bounds and the walkability grid.
 */
export const WORLD_COORD_LIMIT = 1000;
/** Firebase ID tokens are JWTs of roughly 1 KB; anything far larger is rejected outright. */
export const ID_TOKEN_MAX_LENGTH = 4096;

// z.number() already rejects NaN and ±Infinity.
const coord = z.number().min(-WORLD_COORD_LIMIT).max(WORLD_COORD_LIMIT);
const axis = z.number().min(-1).max(1);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** Options passed to `client.joinOrCreate(RoomName.Town, options)`. */
export const JoinOptionsSchema = z.object({
  /** Firebase ID token of the signed-in player. TownRoom.onAuth verifies it with firebase-admin. */
  idToken: z.string().min(1).max(ID_TOKEN_MAX_LENGTH),
  // TODO(M16): friendUid to join a friend's shard.
});
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

/** WASD/arrow movement: a direction on the ground plane (x, z) with length ≤ 1. A zero vector means stop. */
export const MoveInputSchema = z.object({
  kind: z.literal("move"),
  dir: z
    .object({ x: axis, z: axis })
    .refine((d) => d.x * d.x + d.z * d.z <= 1 + 1e-6, { message: "dir must have length <= 1" }),
  run: z.boolean().optional(),
});

/** Click-to-move: a target point on the ground plane. The server plans the path. */
export const ClickInputSchema = z.object({
  kind: z.literal("click"),
  target: z.object({ x: coord, z: coord }),
});

export const PlayerInputSchema = z.discriminatedUnion("kind", [MoveInputSchema, ClickInputSchema]);
export type PlayerInput = z.infer<typeof PlayerInputSchema>;

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
  // TODO(M11): check object ids against the town's interactables.
  z.object({ targetKind: z.literal("object"), targetId: EntityIdSchema }),
]);
export type InteractRequest = z.infer<typeof InteractRequestSchema>;

/** Payload schema for every client → server message. */
export const ClientMessageSchemas = {
  [ClientMessage.PlayerInput]: PlayerInputSchema,
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
