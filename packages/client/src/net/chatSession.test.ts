import type { Room } from "@colyseus/sdk";
import { type ChatBroadcast, ClientMessage, ServerMessage } from "@hellovalley/shared";
import { describe, expect, it } from "vitest";
import type { ChatModeration } from "../ai/moderation";
import { createCachedTranslator, stubTranslator, type TranslateRequest, type Translator } from "../ai/translate";
import { bubbleLines, BUBBLE_MS, lineVisible, nextBubbleExpiry } from "../ui/chat/chatView";
import { CHAT_LOG_MAX, createChatSession } from "./chatSession";

/** A stand-in TownRoom: records sends and lets the test deliver server messages. */
function fakeRoom(sessionId = "me") {
  const handlers = new Map<string, (m: unknown) => void>();
  const leaves: (() => void)[] = [];
  const sent: [string, unknown][] = [];
  const room = {
    sessionId,
    connection: { isOpen: true },
    send: (type: string, payload: unknown) => sent.push([type, payload]),
    onMessage: (type: string, handler: (m: unknown) => void) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    onLeave: (cb: () => void) => leaves.push(cb),
  };
  return {
    room: room as unknown as Room,
    raw: room,
    sent,
    handlers,
    deliver: (type: string, m: unknown) => handlers.get(type)?.(m),
    leave: () => leaves.forEach((cb) => cb()),
  };
}

/** A translator that tags text with the target language and records every call. */
function fakeTranslator() {
  const calls: TranslateRequest[] = [];
  const translator: Translator = {
    translate: async (r) => {
      calls.push(r);
      return { ok: true, text: `[${r.to}] ${r.text}`, via: "on-device" };
    },
  };
  return { translator, calls };
}

const quietModeration: ChatModeration = {
  checkOutgoing: async () => ({ flagged: false }),
  checkIncoming: async () => ({ flagged: false }),
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const line = (over: Partial<ChatBroadcast> = {}): ChatBroadcast => ({ id: "m1", from: "bob", name: "Bob", text: "hola", lang: "es", ts: 1, ...over });

describe("chat session (M18)", () => {
  it("shows each line in the reader's target language, with the original and native translation on hover", async () => {
    const { translator, calls } = fakeTranslator();
    const chat = createChatSession({ translator, moderation: quietModeration });
    const { room, deliver } = fakeRoom();
    chat.setReader({ targetLang: "ja", nativeLang: "en" });
    chat.attach(room);

    deliver(ServerMessage.ChatMessage, line());
    const pending = chat.store.getState().lines[0]!;
    expect(pending.shown).toEqual({ status: "pending", text: "hola" });
    expect(pending.flagged).toBeNull();
    await flush();
    const ready = chat.store.getState().lines[0]!;
    expect(ready.shown).toEqual({ status: "translated", text: "[ja] hola" });
    expect(ready.flagged).toBe(false);
    expect(ready.hover.status).toBe("idle");
    expect(calls).toEqual([{ messageId: "m1", text: "hola", from: "es", to: "ja" }]);

    // Hover: the native-language translation, fetched once.
    chat.requestHover("m1");
    expect(chat.store.getState().lines[0]!.hover.status).toBe("pending");
    chat.requestHover("m1");
    await flush();
    expect(chat.store.getState().lines[0]!.hover).toEqual({ status: "ready", text: "[en] hola" });
    chat.requestHover("m1");
    expect(calls.map((c) => c.to)).toEqual(["ja", "en"]);

    // A line in the reader's target language is shown as written: no translation at all.
    deliver(ServerMessage.ChatMessage, line({ id: "m2", text: "こんにちは", lang: "ja" }));
    await flush();
    const asWritten = chat.store.getState().lines[1]!;
    expect(asWritten.shown).toEqual({ status: "original", text: "こんにちは" });
    expect(asWritten.hover.status).toBe("none");
    chat.requestHover("m2");
    expect(calls).toHaveLength(2);

    // A line already in the native language: hover shows just the original.
    deliver(ServerMessage.ChatMessage, line({ id: "m3", text: "hello", lang: "en" }));
    await flush();
    expect(chat.store.getState().lines[2]!).toMatchObject({ shown: { status: "translated", text: "[ja] hello" }, hover: { status: "none" } });
  });

  it("two readers with different target languages see the same message differently", async () => {
    const { translator } = fakeTranslator();
    const alice = createChatSession({ translator, moderation: quietModeration });
    const bob = createChatSession({ translator, moderation: quietModeration });
    alice.setReader({ targetLang: "ja", nativeLang: "en" });
    bob.setReader({ targetLang: "en", nativeLang: "es" });
    const a = fakeRoom("alice");
    const b = fakeRoom("bob");
    alice.attach(a.room);
    bob.attach(b.room);
    const m = line({ id: "x", from: "carol", text: "bonjour", lang: "fr" });
    a.deliver(ServerMessage.ChatMessage, m);
    b.deliver(ServerMessage.ChatMessage, m);
    await flush();
    expect(alice.store.getState().lines[0]!.shown.text).toBe("[ja] bonjour");
    expect(bob.store.getState().lines[0]!.shown.text).toBe("[en] bonjour");
  });

  it("falls back to the original with the stub translator, and caches translations per message id", async () => {
    const chat = createChatSession({ translator: createCachedTranslator(stubTranslator), moderation: quietModeration });
    const { room, deliver } = fakeRoom();
    chat.setReader({ targetLang: "ja", nativeLang: "en" });
    chat.attach(room);
    deliver(ServerMessage.ChatMessage, line());
    await flush();
    expect(chat.store.getState().lines[0]!.shown).toEqual({ status: "unavailable", text: "hola" });
    chat.requestHover("m1");
    await flush();
    expect(chat.store.getState().lines[0]!.hover.status).toBe("unavailable");
    // Duplicate deliveries of the same id are ignored.
    deliver(ServerMessage.ChatMessage, line());
    expect(chat.store.getState().lines).toHaveLength(1);
  });

  it("collapses lines the reader-side check flags until revealed; own lines skip it", async () => {
    const moderation: ChatModeration = {
      checkOutgoing: async (text) => (text.includes("rude") ? { flagged: true } : { flagged: false }),
      checkIncoming: async (text) => (text.includes("rude") ? { flagged: true } : { flagged: false }),
    };
    const chat = createChatSession({ translator: fakeTranslator().translator, moderation });
    const { room, deliver, sent } = fakeRoom("me");
    chat.setReader({ targetLang: "es", nativeLang: "en" });
    chat.attach(room);
    deliver(ServerMessage.ChatMessage, line({ id: "r", text: "so rude", lang: "es" }));
    expect(lineVisible(chat.store.getState().lines[0]!)).toBe(false);
    await flush();
    expect(chat.store.getState().lines[0]!.flagged).toBe(true);
    expect(lineVisible(chat.store.getState().lines[0]!)).toBe(false);
    chat.reveal("r");
    expect(lineVisible(chat.store.getState().lines[0]!)).toBe(true);
    deliver(ServerMessage.ChatMessage, line({ id: "o", from: "me", name: "Me", text: "hola" }));
    expect(chat.store.getState().lines[1]).toMatchObject({ own: true, flagged: false });

    // Sender pre-check: a flagged line waits for "send anyway".
    expect(await chat.send("  you are rude ", "es")).toBe("flagged");
    expect(sent).toEqual([]);
    expect(await chat.send("you are rude", "es", true)).toBe("sent");
    expect(await chat.send("   ", "es")).toBe("empty");
    expect(sent).toEqual([[ClientMessage.Chat, { text: "you are rude", lang: "es" }]]);
  });

  it("sends mute, block, unblock and report, and mirrors the server's lists and answers", async () => {
    const chat = createChatSession({ translator: stubTranslator, moderation: quietModeration });
    const { room, deliver, sent, handlers, leave, raw } = fakeRoom();
    chat.attach(room);
    expect(chat.store.getState().online).toBe(true);
    chat.mute("bob", true);
    chat.block("bob");
    chat.unblock("bob-uid");
    chat.report({ from: "bob", id: "m9" }, "spam");
    expect(sent).toEqual([
      [ClientMessage.ChatMute, { sessionId: "bob", muted: true }],
      [ClientMessage.ChatBlock, { sessionId: "bob" }],
      [ClientMessage.ChatUnblock, { uid: "bob-uid" }],
      [ClientMessage.ChatReport, { sessionId: "bob", messageId: "m9", reason: "spam" }],
    ]);
    deliver(ServerMessage.ChatSafety, { muted: ["bob"], blocked: [{ uid: "carol", name: "Carol" }] });
    expect(chat.store.getState()).toMatchObject({ muted: ["bob"], blocked: [{ uid: "carol", name: "Carol" }] });
    deliver(ServerMessage.ChatRejected, { reason: "rate" });
    expect(chat.store.getState().notice).toEqual({ kind: "rejected", reason: "rate" });
    deliver(ServerMessage.ChatReported, { ok: true });
    expect(chat.store.getState().notice).toEqual({ kind: "reported", ok: true });
    chat.clearNotice();
    expect(chat.store.getState().notice).toBeNull();

    // Offline: nothing goes out.
    raw.connection.isOpen = false;
    expect(await chat.send("hi", "en")).toBe("offline");
    leave();
    expect(handlers.size).toBe(0);
    expect(chat.store.getState()).toMatchObject({ online: false, muted: [], blocked: [] });
  });

  it("keeps the log bounded", () => {
    const chat = createChatSession({ translator: stubTranslator, moderation: quietModeration });
    const { room, deliver } = fakeRoom();
    chat.attach(room);
    for (let k = 0; k < CHAT_LOG_MAX + 5; k++) deliver(ServerMessage.ChatMessage, line({ id: `m${k}` }));
    expect(chat.store.getState().lines).toHaveLength(CHAT_LOG_MAX);
    expect(chat.store.getState().lines[0]!.id).toBe("m5");
  });
});

describe("cached translator", () => {
  it("translates each message id and target once, sharing in-flight calls", async () => {
    const { translator, calls } = fakeTranslator();
    const cached = createCachedTranslator(translator);
    const req = { messageId: "m1", text: "hola", from: "es", to: "ja" };
    const [a, b] = await Promise.all([cached.translate(req), cached.translate(req)]);
    expect(a).toEqual(b);
    await cached.translate({ ...req, to: "JA" });
    await cached.translate({ ...req, to: "en" });
    await cached.translate({ ...req, messageId: "m2" });
    expect(calls.map((c) => `${c.messageId}:${c.to}`)).toEqual(["m1:ja", "m1:en", "m2:ja"]);
    expect(cached.size).toBe(3);
  });

  it("forgets failures so a later request tries again, and evicts the oldest entries", async () => {
    let fail = true;
    let n = 0;
    const flaky: Translator = {
      translate: async (r) => {
        n++;
        if (fail) throw new Error("model not ready");
        return { ok: true, text: r.text, via: "cloud" };
      },
    };
    const cached = createCachedTranslator(flaky, 2);
    expect(await cached.translate({ messageId: "a", text: "x", from: "es", to: "en" })).toEqual({ ok: false, reason: "failed" });
    expect(cached.size).toBe(0);
    fail = false;
    expect((await cached.translate({ messageId: "a", text: "x", from: "es", to: "en" })).ok).toBe(true);
    await cached.translate({ messageId: "b", text: "x", from: "es", to: "en" });
    await cached.translate({ messageId: "c", text: "x", from: "es", to: "en" });
    expect(cached.size).toBe(2);
    await cached.translate({ messageId: "a", text: "x", from: "es", to: "en" });
    expect(n).toBe(5);
  });
});

describe("chat view helpers", () => {
  it("shows a speaker's newest visible lines for a few seconds", async () => {
    let clock = 1000;
    const chat = createChatSession({ translator: stubTranslator, moderation: quietModeration, now: () => clock });
    const { room, deliver } = fakeRoom();
    chat.attach(room);
    deliver(ServerMessage.ChatMessage, line({ id: "1" }));
    clock = 2000;
    deliver(ServerMessage.ChatMessage, line({ id: "2" }));
    deliver(ServerMessage.ChatMessage, line({ id: "3" }));
    deliver(ServerMessage.ChatMessage, line({ id: "other", from: "carol" }));
    // Before the reader check finishes nothing shows.
    expect(bubbleLines(chat.store.getState().lines, "bob", 2000)).toEqual([]);
    await flush();
    const lines = chat.store.getState().lines;
    expect(bubbleLines(lines, "bob", 2000).map((l) => l.id)).toEqual(["2", "3"]);
    expect(bubbleLines(lines, "bob", 1000 + BUBBLE_MS + 1).map((l) => l.id)).toEqual(["2", "3"]);
    expect(bubbleLines(lines, "bob", 2000 + BUBBLE_MS)).toEqual([]);
    expect(nextBubbleExpiry(bubbleLines(lines, "bob", 2000), 2500)).toBe(BUBBLE_MS - 500);
    expect(nextBubbleExpiry([], 0)).toBeNull();
  });
});
