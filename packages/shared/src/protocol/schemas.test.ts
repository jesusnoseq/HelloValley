import { describe, expect, it } from "vitest";
import { CLIENT_MESSAGE_TYPES, ClientMessage, isClientMessage, RoomName } from "./messages";
import {
  CHAT_MAX_LENGTH,
  ChatMessageSchema,
  ClientMessageSchemas,
  ID_TOKEN_MAX_LENGTH,
  InteractRequestSchema,
  JoinOptionsSchema,
  parseClientMessage,
  PlayerInputSchema,
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
    expect(isClientMessage("npc:reply")).toBe(false);
    expect(isClientMessage(42)).toBe(false);
  });

  it("names the town room", () => {
    expect(RoomName.Town).toBe("town");
  });
});

describe("JoinOptionsSchema", () => {
  it("accepts empty options and an ID token", () => {
    expect(JoinOptionsSchema.parse({})).toEqual({});
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

describe("PlayerInputSchema", () => {
  it("accepts unit and zero move directions", () => {
    expect(PlayerInputSchema.parse({ kind: "move", dir: { x: 1, z: 0 } })).toEqual({ kind: "move", dir: { x: 1, z: 0 } });
    expect(PlayerInputSchema.safeParse({ kind: "move", dir: { x: 0, z: 0 } }).success).toBe(true);
    const d = Math.SQRT1_2;
    expect(PlayerInputSchema.safeParse({ kind: "move", dir: { x: d, z: -d }, run: true }).success).toBe(true);
  });

  it("rejects directions longer than 1 or out of range", () => {
    expect(PlayerInputSchema.safeParse({ kind: "move", dir: { x: 1, z: 1 } }).success).toBe(false);
    expect(PlayerInputSchema.safeParse({ kind: "move", dir: { x: 2, z: 0 } }).success).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(PlayerInputSchema.safeParse({ kind: "move", dir: { x: bad, z: 0 } }).success).toBe(false);
      expect(PlayerInputSchema.safeParse({ kind: "click", target: { x: bad, z: 0 } }).success).toBe(false);
    }
  });

  it("accepts click targets within the world bounds", () => {
    expect(PlayerInputSchema.parse({ kind: "click", target: { x: 12.5, z: -3 } })).toEqual({
      kind: "click",
      target: { x: 12.5, z: -3 },
    });
    expect(
      PlayerInputSchema.safeParse({ kind: "click", target: { x: WORLD_COORD_LIMIT + 1, z: 0 } }).success,
    ).toBe(false);
  });

  it("rejects unknown kinds and missing fields", () => {
    expect(PlayerInputSchema.safeParse({ kind: "teleport", target: { x: 0, z: 0 } }).success).toBe(false);
    expect(PlayerInputSchema.safeParse({ kind: "move" }).success).toBe(false);
    expect(PlayerInputSchema.safeParse({ kind: "click", target: { x: 0 } }).success).toBe(false);
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
});

describe("parseClientMessage", () => {
  it("returns the parsed value for valid payloads", () => {
    expect(parseClientMessage(ClientMessage.Chat, { text: " hi " })).toEqual({ ok: true, value: { text: "hi" } });
  });

  it("returns an error instead of throwing for invalid payloads", () => {
    const result = parseClientMessage(ClientMessage.PlayerInput, { kind: "move", dir: { x: 5, z: 0 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dir/);
    expect(parseClientMessage(ClientMessage.Interact, undefined).ok).toBe(false);
  });
});
