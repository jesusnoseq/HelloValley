import { describe, expect, it } from "vitest";
import {
  BlockListSchema,
  CHAT_MAX_LENGTH,
  ChatReportDocSchema,
  ClientMessage,
  FirestorePaths,
  MAX_BLOCKED_PLAYERS,
  parseClientMessage,
} from "../index";
import { activeTargetLang, chatDisplayPlan, chatReaderOf, sameLanguage } from "./display";
import { CHAT_RADIUS_M, type ChatPosition, chatAudible } from "./proximity";
import { CHAT_RATE, createTokenBucket, takeToken } from "./rate";

describe("chatDisplayPlan (GDD §6.6 display rule)", () => {
  // An English speaker learning Japanese, and a Spanish speaker learning English.
  const aiko = { targetLang: "ja", nativeLang: "en" };
  const luis = { targetLang: "en", nativeLang: "es" };

  it("shows a line written in the reader's target language as written, with no translation", () => {
    expect(chatDisplayPlan("ja", aiko)).toEqual({ shownLang: "ja", translateTo: null, hover: null });
    expect(chatDisplayPlan("en", luis)).toEqual({ shownLang: "en", translateTo: null, hover: null });
  });

  it("translates other lines into the reader's target language, hover adds the native translation", () => {
    // Luis writes in Spanish: Aiko reads it in Japanese, hover shows the Spanish plus English.
    expect(chatDisplayPlan("es", aiko)).toEqual({ shownLang: "ja", translateTo: "ja", hover: { translateTo: "en" } });
    // Aiko writes in Japanese: Luis reads it in English, hover shows the Japanese plus Spanish.
    expect(chatDisplayPlan("ja", luis)).toEqual({ shownLang: "en", translateTo: "en", hover: { translateTo: "es" } });
  });

  it("needs no native translation on hover when the original already is in the native language", () => {
    // Aiko's English line, read by Aiko herself: shown in Japanese, hover is just the original.
    expect(chatDisplayPlan("en", aiko)).toEqual({ shownLang: "ja", translateTo: "ja", hover: { translateTo: null } });
    // Luis's Spanish line for Luis.
    expect(chatDisplayPlan("es", luis)).toEqual({ shownLang: "en", translateTo: "en", hover: { translateTo: null } });
  });

  it("two readers with different target languages each get their own target language", () => {
    for (const lang of ["fr", "de", "ko"]) {
      expect(chatDisplayPlan(lang, aiko).shownLang).toBe("ja");
      expect(chatDisplayPlan(lang, luis).shownLang).toBe("en");
      expect(chatDisplayPlan(lang, aiko).translateTo).toBe("ja");
      expect(chatDisplayPlan(lang, luis).translateTo).toBe("en");
    }
  });

  it("compares language codes case-insensitively, but keeps regional variants apart", () => {
    expect(sameLanguage("zh-Hant", "zh-hant")).toBe(true);
    expect(sameLanguage("pt", "pt-BR")).toBe(false);
    expect(chatDisplayPlan("JA", aiko).translateTo).toBeNull();
  });

  it("asks for no native translation when target and native are the same language", () => {
    expect(chatDisplayPlan("fr", { targetLang: "en", nativeLang: "en" })).toEqual({ shownLang: "en", translateTo: "en", hover: { translateTo: null } });
  });

  it("reads the reader from a profile (first target language)", () => {
    expect(activeTargetLang({ targetLangs: ["ja", "fr"] })).toBe("ja");
    expect(chatReaderOf({ targetLangs: ["ko"], nativeLang: "de" })).toEqual({ targetLang: "ko", nativeLang: "de" });
  });
});

describe("chatAudible (12 m proximity)", () => {
  const at = (x: number, z: number, over: Partial<ChatPosition> = {}): ChatPosition => ({ space: "town", x, z, instance: null, ...over });

  it("reaches listeners within 12 m and not beyond", () => {
    expect(CHAT_RADIUS_M).toBe(12);
    expect(chatAudible(at(0, 0), at(0, 0))).toBe(true);
    expect(chatAudible(at(0, 0), at(7.2, 9.6))).toBe(true); // exactly 12 m
    expect(chatAudible(at(0, 0), at(12.01, 0))).toBe(false);
    expect(chatAudible(at(10, 10), at(-1, 14))).toBe(true);
  });

  it("needs the same space, and in an apartment the same apartment", () => {
    expect(chatAudible(at(0, 0), at(0, 0, { space: "bakery" }))).toBe(false);
    expect(chatAudible(at(1, 1, { space: "bakery" }), at(2, 2, { space: "bakery" }))).toBe(true);
    const home = (owner: string) => ({ space: "apartment" as const, instance: owner });
    expect(chatAudible(at(1, 1, home("alice")), at(2, 1, home("alice")))).toBe(true);
    expect(chatAudible(at(1, 1, home("alice")), at(2, 1, home("bob")))).toBe(false);
  });

  it("never matches garbage positions", () => {
    expect(chatAudible(at(Number.NaN, 0), at(0, 0))).toBe(false);
  });
});

describe("chat token bucket", () => {
  it("allows a burst, then one line per refill interval", () => {
    const b = createTokenBucket(CHAT_RATE, 0);
    for (let k = 0; k < CHAT_RATE.burst; k++) expect(takeToken(b, CHAT_RATE, 0)).toBe(true);
    expect(takeToken(b, CHAT_RATE, 0)).toBe(false);
    expect(takeToken(b, CHAT_RATE, 1000)).toBe(false);
    expect(takeToken(b, CHAT_RATE, 1500)).toBe(true);
    expect(takeToken(b, CHAT_RATE, 1600)).toBe(false);
    // A long pause refills only up to the burst.
    for (let k = 0; k < CHAT_RATE.burst; k++) expect(takeToken(b, CHAT_RATE, 600_000)).toBe(true);
    expect(takeToken(b, CHAT_RATE, 600_000)).toBe(false);
  });

  it("does not refill when the clock goes backwards", () => {
    const b = createTokenBucket({ burst: 1, perSecond: 1 }, 10_000);
    expect(takeToken(b, { burst: 1, perSecond: 1 }, 10_000)).toBe(true);
    expect(takeToken(b, { burst: 1, perSecond: 1 }, 5_000)).toBe(false);
  });
});

describe("chat protocol schemas", () => {
  it("accepts a line with or without a language and rejects bad ones", () => {
    expect(parseClientMessage(ClientMessage.Chat, { text: "  hola  " })).toEqual({ ok: true, value: { text: "hola" } });
    expect(parseClientMessage(ClientMessage.Chat, { text: "こんにちは", lang: "ja" })).toMatchObject({ ok: true, value: { lang: "ja" } });
    expect(parseClientMessage(ClientMessage.Chat, { text: "hi", lang: "klingon" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.Chat, { text: "x".repeat(CHAT_MAX_LENGTH + 1) }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.Chat, { text: "a\u0007b" }).ok).toBe(false);
  });

  it("validates mute, block, unblock and report payloads", () => {
    expect(parseClientMessage(ClientMessage.ChatMute, { sessionId: "abc", muted: true }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.ChatMute, { sessionId: "abc" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.ChatBlock, { sessionId: "abc" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.ChatBlock, { sessionId: "a/b" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.ChatUnblock, { uid: "u1" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.ChatUnblock, { uid: "" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.ChatReport, { sessionId: "abc", messageId: "m-1", reason: "spam" }).ok).toBe(true);
    expect(parseClientMessage(ClientMessage.ChatReport, { sessionId: "abc", reason: "boring" }).ok).toBe(false);
    expect(parseClientMessage(ClientMessage.ChatReport, { sessionId: "abc", reason: "other", extra: 1 }).ok).toBe(false);
  });
});

describe("safety documents", () => {
  it("builds the block list path and caps the list", () => {
    expect(FirestorePaths.blockList("u1")).toBe("users/u1/safety/blocks");
    expect(BlockListSchema.safeParse({ players: [{ uid: "u2", name: "Bob" }] }).success).toBe(true);
    const many = Array.from({ length: MAX_BLOCKED_PLAYERS + 1 }, (_, k) => ({ uid: `u${k}`, name: "X" }));
    expect(BlockListSchema.safeParse({ players: many }).success).toBe(false);
  });

  it("validates report documents", () => {
    const report = {
      kind: "chat",
      reporterUid: "alice",
      reportedUid: "bob",
      reportedName: "Bob",
      reason: "harassment",
      messageId: "m1",
      shard: 1,
      messages: [{ id: "m1", text: "rude", lang: "en", ts: 1 }],
      createdAt: { seconds: 1, nanoseconds: 0 },
    };
    expect(ChatReportDocSchema.safeParse(report).success).toBe(true);
    expect(ChatReportDocSchema.safeParse({ ...report, reason: "nope" }).success).toBe(false);
    expect(ChatReportDocSchema.safeParse({ ...report, createdAt: undefined }).success).toBe(false);
  });
});
