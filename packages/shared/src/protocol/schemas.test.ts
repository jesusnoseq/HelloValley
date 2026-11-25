import { describe, expect, it } from "vitest";
import { CHAT_MAX_LENGTH, CLIENT_MESSAGE_TYPES, ClientMessage, isClientMessage, RoomName } from "./messages";
import {
  ApartmentJoinOptionsSchema,
  FurnitureEditSchema,
  IntercomListSchema,
  VisitAnswerSchema,
  VisitRequestSchema,
  ChatMessageSchema,
  ClientMessageSchemas,
  ID_TOKEN_MAX_LENGTH,
  InteractRequestSchema,
  JoinOptionsSchema,
  EmoteRequestSchema,
  HEADING_LIMIT,
  parseClientMessage,
  PlayerMoveSchema,
  ShardsResponseSchema,
  TimeSyncRequestSchema,
  UidSchema,
  WORLD_COORD_LIMIT,
} from "./schemas";

describe("message names", () => {
  it("are unique and namespaced", () => {
    expect(new Set(CLIENT_MESSAGE_TYPES).size).toBe(CLIENT_MESSAGE_TYPES.length);
    for (const type of CLIENT_MESSAGE_TYPES) expect(type).toMatch(/^[a-z]+:[a-z]+$/);
  });

  it("every client message has a payload schema", () => {
    expect(Object.keys(ClientMessageSchemas).sort()).toEqual([...CLIENT_MESSAGE_TYPES].sort());
  });

  it("isClientMessage accepts known names only", () => {
    expect(isClientMessage(ClientMessage.Chat)).toBe(true);
    expect(isClientMessage("npc:teleport")).toBe(false);
    expect(isClientMessage(42)).toBe(false);
  });

  it("names the town room", () => {
    expect(RoomName.Town).toBe("town");
  });
});

describe("JoinOptionsSchema", () => {
  it("requires an ID token", () => {
    expect(JoinOptionsSchema.safeParse({}).success).toBe(false);
    expect(JoinOptionsSchema.parse({ idToken: "abc.def.ghi" })).toEqual({ idToken: "abc.def.ghi" });
  });

  it("strips unknown keys", () => {
    expect(JoinOptionsSchema.parse({ idToken: "t", coins: 9999 })).toEqual({ idToken: "t" });
  });

  it("rejects empty, oversized and non-string tokens", () => {
    expect(JoinOptionsSchema.safeParse({ idToken: "" }).success).toBe(false);
    expect(JoinOptionsSchema.safeParse({ idToken: "x".repeat(ID_TOKEN_MAX_LENGTH + 1) }).success).toBe(false);
    expect(JoinOptionsSchema.safeParse({ idToken: 123 }).success).toBe(false);
    expect(JoinOptionsSchema.safeParse(null).success).toBe(false);
  });
});

describe("PlayerMoveSchema", () => {
  const move = { seq: 1, epoch: 0, space: "town", x: 12.5, z: -3, heading: 1.2, motion: "walk" };

  it("accepts a position report in the town or an interior", () => {
    expect(PlayerMoveSchema.parse(move)).toEqual(move);
    expect(PlayerMoveSchema.safeParse({ ...move, space: "bakery", motion: "idle" }).success).toBe(true);
    expect(PlayerMoveSchema.safeParse({ ...move, motion: "run" }).success).toBe(true);
  });

  it("rejects unknown spaces and motions", () => {
    expect(PlayerMoveSchema.safeParse({ ...move, space: "moon" }).success).toBe(false);
    expect(PlayerMoveSchema.safeParse({ ...move, motion: "fly" }).success).toBe(false);
  });

  it("rejects non-finite numbers and out-of-range coordinates", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(PlayerMoveSchema.safeParse({ ...move, x: bad }).success).toBe(false);
      expect(PlayerMoveSchema.safeParse({ ...move, heading: bad }).success).toBe(false);
    }
    expect(PlayerMoveSchema.safeParse({ ...move, x: WORLD_COORD_LIMIT + 1 }).success).toBe(false);
    expect(PlayerMoveSchema.safeParse({ ...move, heading: HEADING_LIMIT + 1 }).success).toBe(false);
  });

  it("requires non-negative integer seq and epoch", () => {
    expect(PlayerMoveSchema.safeParse({ ...move, seq: -1 }).success).toBe(false);
    expect(PlayerMoveSchema.safeParse({ ...move, seq: 1.5 }).success).toBe(false);
    expect(PlayerMoveSchema.safeParse({ ...move, epoch: undefined }).success).toBe(false);
  });
});

describe("EmoteRequestSchema", () => {
  it("accepts the five hotbar emotes only", () => {
    for (const emote of ["wave", "laugh", "cheer", "clap", "heart"]) {
      expect(EmoteRequestSchema.safeParse({ emote }).success).toBe(true);
    }
    expect(EmoteRequestSchema.safeParse({ emote: "think" }).success).toBe(false);
    expect(EmoteRequestSchema.safeParse({ emote: "dance" }).success).toBe(false);
  });
});

describe("TimeSyncRequestSchema", () => {
  it("needs a finite client time", () => {
    expect(TimeSyncRequestSchema.safeParse({ t: 123.4 }).success).toBe(true);
    expect(TimeSyncRequestSchema.safeParse({ t: Number.NaN }).success).toBe(false);
    expect(TimeSyncRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("ShardsResponseSchema", () => {
  it("parses a shard list with and without a friend", () => {
    const shard = { roomId: "abc", shard: 1, clients: 3, maxClients: 40 };
    expect(ShardsResponseSchema.parse({ shards: [shard], friend: null })).toEqual({ shards: [shard], friend: null });
    expect(ShardsResponseSchema.safeParse({ shards: [], friend: shard }).success).toBe(true);
    expect(ShardsResponseSchema.safeParse({ shards: [{ ...shard, shard: 0 }], friend: null }).success).toBe(false);
  });

  it("UidSchema accepts Firebase-style uids only", () => {
    expect(UidSchema.safeParse("aB3_x-9").success).toBe(true);
    expect(UidSchema.safeParse("").success).toBe(false);
    expect(UidSchema.safeParse("a/b").success).toBe(false);
    expect(UidSchema.safeParse("x".repeat(129)).success).toBe(false);
  });
});

describe("ChatMessageSchema", () => {
  it("trims text", () => {
    expect(ChatMessageSchema.parse({ text: "  hola!  " })).toEqual({ text: "hola!" });
  });

  it("accepts the maximum length and non-Latin scripts", () => {
    expect(ChatMessageSchema.safeParse({ text: "a".repeat(CHAT_MAX_LENGTH) }).success).toBe(true);
    expect(ChatMessageSchema.safeParse({ text: "こんにちは、パンをください" }).success).toBe(true);
  });

  it("rejects empty, whitespace-only, too long and control-character text", () => {
    expect(ChatMessageSchema.safeParse({ text: "" }).success).toBe(false);
    expect(ChatMessageSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(ChatMessageSchema.safeParse({ text: "a".repeat(CHAT_MAX_LENGTH + 1) }).success).toBe(false);
    expect(ChatMessageSchema.safeParse({ text: "hi\u0000there" }).success).toBe(false);
    expect(ChatMessageSchema.safeParse({ text: "line\nbreak" }).success).toBe(false);
  });
});

describe("InteractRequestSchema", () => {
  it("accepts NPC and object targets", () => {
    expect(InteractRequestSchema.parse({ targetKind: "npc", targetId: "baker" })).toEqual({
      targetKind: "npc",
      targetId: "baker",
    });
    expect(InteractRequestSchema.safeParse({ targetKind: "object", targetId: "notice_board" }).success).toBe(true);
  });

  it("rejects unknown kinds and malformed ids", () => {
    expect(InteractRequestSchema.safeParse({ targetKind: "player", targetId: "baker" }).success).toBe(false);
    for (const id of ["", "Baker", "../etc", "a".repeat(65), "baker shop"]) {
      expect(InteractRequestSchema.safeParse({ targetKind: "npc", targetId: id }).success).toBe(false);
    }
  });

  it("only accepts registered NPC ids for NPC targets", () => {
    expect(InteractRequestSchema.safeParse({ targetKind: "npc", targetId: "wizard" }).success).toBe(false);
    expect(InteractRequestSchema.safeParse({ targetKind: "object", targetId: "wizard" }).success).toBe(true);
  });
});

describe("parseClientMessage", () => {
  it("returns the parsed value for valid payloads", () => {
    expect(parseClientMessage(ClientMessage.Chat, { text: " hi " })).toEqual({ ok: true, value: { text: "hi" } });
  });

  it("returns an error instead of throwing for invalid payloads", () => {
    const result = parseClientMessage(ClientMessage.PlayerMove, { seq: 1, epoch: 0, space: "town", x: 5, z: 0, heading: 0, motion: "teleport" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/motion/);
    expect(parseClientMessage(ClientMessage.Interact, undefined).ok).toBe(false);
  });
});

describe("apartment and visit messages (M17)", () => {
  it("names the apartment room and needs an owner uid to join it", () => {
    expect(RoomName.Apartment).toBe("apartment");
    expect(ApartmentJoinOptionsSchema.safeParse({ idToken: "t", owner: "abc_123" }).success).toBe(true);
    expect(ApartmentJoinOptionsSchema.safeParse({ idToken: "t" }).success).toBe(false);
    expect(ApartmentJoinOptionsSchema.safeParse({ idToken: "t", owner: "../x" }).success).toBe(false);
  });

  it("validates intercom and visit payloads", () => {
    expect(IntercomListSchema.safeParse(undefined).success).toBe(true);
    expect(IntercomListSchema.safeParse({}).success).toBe(true);
    expect(IntercomListSchema.safeParse({ all: true }).success).toBe(false);
    expect(VisitRequestSchema.safeParse({ sessionId: "AbC12_x" }).success).toBe(true);
    expect(VisitRequestSchema.safeParse({ sessionId: "" }).success).toBe(false);
    expect(VisitAnswerSchema.safeParse({ requestId: "r1", accept: true }).success).toBe(true);
    expect(VisitAnswerSchema.safeParse({ requestId: "r1", accept: "yes" }).success).toBe(false);
  });

  it("validates furniture edits", () => {
    expect(FurnitureEditSchema.safeParse({ op: "move", editId: 1, index: 3, itemId: "bed", x: 2.5, z: 3, rot: 180 }).success).toBe(true);
    expect(FurnitureEditSchema.safeParse({ op: "store", editId: 2, index: 0, itemId: "wooden_chair" }).success).toBe(true);
    expect(FurnitureEditSchema.safeParse({ op: "place", editId: 3, itemId: "fern", x: 1, z: 1, rot: 0 }).success).toBe(true);
    for (const bad of [
      { op: "move", editId: 1, index: 3, itemId: "bed", x: 2.5, z: 3, rot: 45 },
      { op: "move", editId: 1, index: -1, itemId: "bed", x: 2.5, z: 3, rot: 0 },
      { op: "place", editId: 1, itemId: "throne", x: 1, z: 1, rot: 0 },
      { op: "place", editId: 1, itemId: "fern", x: Number.NaN, z: 1, rot: 0 },
      { op: "store", editId: 1, index: 0, itemId: "bed", extra: 1 },
      { op: "swap", editId: 1 },
    ]) {
      expect(FurnitureEditSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("NPC memory and gifts (build plan M24)", () => {
  const memory = {
    conversationId: "conv-1",
    summary: "Lia likes rye bread.",
    facts: ["Lia likes rye bread"],
    signals: { comprehension: 1.4, expression: 0.5, usedNativeLanguage: false, struggles: ["numbers"] },
    telemetry: { suggested: 1, free: 3, npcLines: 5, translationsShown: 2, corrections: 0 },
  };

  it("parses npc:memory leniently (clamped scores and counts) but rejects the wrong shape", () => {
    const parsed = parseClientMessage(ClientMessage.NpcMemory, memory);
    expect(parsed.ok && parsed.value.signals.comprehension).toBe(1);
    expect(parseClientMessage(ClientMessage.NpcMemory, { ...memory, telemetry: undefined }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.NpcMemory, { ...memory, conversationId: "../x" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.NpcMemory, { ...memory, facts: "all of them" }).ok).toBe(false);
  });

  it("parses npc:gift with a known item id only", () => {
    expect(parseClientMessage(ClientMessage.NpcGift, { conversationId: "conv-1", itemId: "butter" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.NpcGift, { conversationId: "conv-1", itemId: "gold_bar" }).ok).toBe(false);
  });
});
