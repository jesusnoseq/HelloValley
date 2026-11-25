// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMessage, type NpcContextMessage, type NpcId } from "@hellovalley/shared";
import { npcContextFixture } from "../../../../shared/src/npc/fixtures";
import type { InputHelpers } from "../../ai/client";
import type { TtsClip, TtsSpeaker } from "../../ai/tts";
import { createConversationStore } from "../../state/conversationStore";
import { worldStore } from "../../state/worldStore";
import { scriptModeStore } from "../speech/scriptModeStore";
import type { VoicePlayer } from "../speech/voicePlayer";
import { ConversationController } from "./controller";
import { ConversationLayer } from "./ConversationLayer";
import { fakeNpcAi, fakeNpcServer } from "./fakeNpc";
import type { SpeechInput } from "./speechInput";

// Node's own (file-less) Web Storage global hides jsdom's: use jsdom's (the script mode store reads it).
vi.hoisted(() => {
  const { window } = (globalThis as unknown as { jsdom: { window: Window } }).jsdom;
  Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true, writable: true });
});

/**
 * Build plan M23 acceptance: a full shop conversation with the Baker (Spanish, A1), once by
 * keyboard only and once by mouse only, against a mocked model and a mocked TownRoom.
 */

const clip: TtsClip = { mime: "audio/wav", data: new ArrayBuffer(100), durationMs: 900 };
const noFont = () => Promise.resolve();
const noSpeech: SpeechInput = { supported: false, listen: () => null };

function setup(helpers: InputHelpers | null = null, level: "A1" | "B1" | "C1" = "A1", npcId: NpcId = "baker", over: Partial<NpcContextMessage> = {}) {
  const ctx = { ...npcContextFixture({ npcId, lang: "es", playerLevel: level }), ...over };
  const server = fakeNpcServer(ctx);
  const ai = fakeNpcAi();
  const store = createConversationStore();
  const controller = new ConversationController(
    { room: () => server.room, ai: async () => ai, helpers: async () => helpers, player: () => ({ name: "Lia", animal: "fox", apartmentId: "3B" }), checkTimeoutMs: 200 },
    store,
  );
  const tts: TtsSpeaker & { clip: ReturnType<typeof vi.fn> } = { clip: vi.fn(async () => ({ ok: true as const, clip, source: "memory" as const, hash: "h" })) };
  const voice: VoicePlayer & { play: ReturnType<typeof vi.fn> } = { play: vi.fn(async () => {}), stop: vi.fn() };
  render(<ConversationLayer controller={controller} tts={tts} voice={voice} speech={noSpeech} loadFont={noFont} />);
  return { ctx, server, ai, controller, store, tts, voice };
}

/** Stand next to the Baker (what scene/Player.tsx sets each frame). */
function standAtBaker() {
  act(() => worldStore.setState({ space: "bakery", nearby: { id: "npc:baker", kind: "npc" } }));
}

const active = () => document.activeElement as HTMLElement;
const sentTypes = (server: ReturnType<typeof fakeNpcServer>) => server.sent.map((s) => s.type);

/**
 * Keyboard only: keys go to the focused element, with the browser's default actions that jsdom
 * does not run itself (Enter or Space on a button clicks it; Enter in a form's text box submits).
 */
async function press(key: string, code = key) {
  const target = active();
  await act(async () => {
    const proceed = fireEvent.keyDown(target, { key, code });
    if (proceed && (key === "Enter" || key === " ") && target instanceof HTMLButtonElement) fireEvent.click(target);
    else if (proceed && key === "Enter" && target instanceof HTMLInputElement && target.form) fireEvent.submit(target.form);
  });
}

/** Typing into the focused text box. */
async function type(text: string) {
  const target = active();
  expect(target).toBeInstanceOf(HTMLInputElement);
  await act(async () => {
    fireEvent.change(target, { target: { value: (target as HTMLInputElement).value + text } });
  });
}

beforeEach(() => {
  localStorage.clear();
  scriptModeStore.setState({ modes: {} });
  worldStore.setState({ space: "town", nearby: null });
});

afterEach(() => {
  cleanup();
  worldStore.setState({ space: "town", nearby: null });
});

describe("conversation panel: a full shop conversation", () => {
  it("is playable by keyboard only", async () => {
    // On-device helpers: Spanish detected, and a gentle correction for the first typed line.
    const helpers: InputHelpers = {
      detectLanguage: async () => ({ ok: true, value: { lang: "es" }, source: "on-device" }),
      grammarFeedback: async ({ text }) =>
        text === "Quiero pan" ? { ok: true, value: { ok: false, better: "Quiero pan, por favor.", note: "More polite" }, source: "on-device" } : { ok: true, value: { ok: true }, source: "on-device" },
    };
    const { server, ai, tts, voice } = setup(helpers);
    standAtBaker();
    // F talks to the NPC the player stands next to.
    await act(async () => fireEvent.keyDown(window, { key: "f", code: "KeyF" }));
    expect(server.sent[0]).toEqual({ type: ClientMessage.NpcStart, payload: { npcId: "baker" } });
    const dialog = await screen.findByRole("dialog", { name: "Talking with the Baker" });
    // The opener shows, its voice plays once, and focus is in the reply box.
    await waitFor(() => expect(within(dialog).getAllByText("cariño").length).toBeGreaterThan(0));
    await waitFor(() => expect(voice.play).toHaveBeenCalledWith(clip, 1));
    expect(tts.clip).toHaveBeenCalledWith(expect.objectContaining({ npcId: "baker", lang: "es", text: "¡Hola, cariño! ¿Qué quieres hoy?" }));
    const input = screen.getByRole("textbox", { name: "Your reply in Spanish" });
    await waitFor(() => expect(active()).toBe(input));
    // A1: three starter suggestions.
    expect(within(screen.getByRole("group", { name: "Suggested replies" })).getAllByRole("button")).toHaveLength(3);

    // Type a line; the on-device check offers a better version and focus goes to "Use this".
    await type("Quiero pan");
    await press("Enter");
    const chip = await screen.findByRole("alert");
    expect(chip.textContent).toContain("“Quiero pan, por favor.” sounds more natural.");
    await waitFor(() => expect(active().textContent).toBe("Use this"));
    await press("Enter");
    // The better version went to the model; the NPC offers bread and the trade card takes focus.
    await waitFor(() => expect(ai.calls).toEqual(["Quiero pan, por favor."]));
    const card = await screen.findByRole("group", { name: "The Baker offers: Bread ×1" });
    expect(card.textContent).toContain("5 coins");
    await waitFor(() => expect(active().textContent).toBe("Buy"));
    await press("Enter");
    await waitFor(() => expect(within(card).getByRole("status").textContent).toBe("Bought! You have 45 coins."));
    expect(server.coins()).toBe(45);
    expect(server.inventory()).toEqual([{ itemId: "bread", qty: 1 }]);
    expect(server.sent.find((s) => s.type === ClientMessage.NpcConfirm)?.payload).toMatchObject({ tradeId: "trade-1", accept: true });

    // Back in the reply box: ↑ goes to the model's suggestions, → moves, and focus shows the translation.
    await waitFor(() => expect(active()).toBe(input));
    await press("ArrowUp");
    expect(active().textContent).toBe("Sí, por favor.");
    await press("ArrowRight");
    expect(active().textContent).toBe("¿Cuánto cuesta?");
    expect(screen.getByRole("tooltip").textContent).toBe("How much is it?");
    await press("ArrowRight");
    await press("ArrowRight");
    // Past the last one, focus returns to the reply box.
    expect(active()).toBe(input);

    // Goodbye in Spanish: the NPC ends the conversation; Escape closes the panel and sends npc:end,
    // then the conversation's compaction (build plan M24).
    await type("Adiós");
    await press("Enter");
    await screen.findByText("The conversation is over.");
    await press("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sentTypes(server)).toEqual([ClientMessage.NpcStart, ClientMessage.NpcReply, ClientMessage.NpcConfirm, ClientMessage.NpcReply, ClientMessage.NpcEnd, ClientMessage.NpcMemory]);
  });

  it("is playable by mouse only", async () => {
    const { server, ai } = setup(null);
    standAtBaker();
    // The "Talk to" button next to the NPC (the scene's NPC click does the same).
    fireEvent.click(screen.getByRole("button", { name: /Talk to the Baker/ }));
    const dialog = await screen.findByRole("dialog", { name: "Talking with the Baker" });
    await waitFor(() => expect(within(dialog).getAllByText("cariño").length).toBeGreaterThan(0));
    // Hovering a suggestion shows its translation; clicking sends it as is.
    const ask = screen.getByRole("button", { name: "¿Qué tienes hoy?" });
    fireEvent.pointerEnter(ask.parentElement!);
    expect(screen.getByRole("tooltip").textContent).toBe("What do you have today?");
    fireEvent.click(ask);
    await waitFor(() => expect(ai.calls).toEqual(["¿Qué tienes hoy?"]));
    // Hovering a word of the reply shows its gloss (M19 bubble).
    const word = await screen.findByRole("button", { name: "Pan" });
    fireEvent.pointerEnter(word);
    expect(screen.getAllByRole("tooltip").some((t) => t.textContent?.includes("bread"))).toBe(true);
    // Buy the bread.
    const card = await screen.findByRole("group", { name: "The Baker offers: Bread ×1" });
    fireEvent.click(within(card).getByRole("button", { name: "Buy" }));
    await waitFor(() => expect(within(card).getByRole("status").textContent).toBe("Bought! You have 45 coins."));
    expect(screen.getByText(/45 coins/, { selector: ".hv-convo__coins" })).toBeTruthy();
    // A second offer, declined.
    fireEvent.click(screen.getByRole("button", { name: "¿Cuánto cuesta?" }));
    await waitFor(() => expect(ai.calls).toHaveLength(2));
    const second = await waitFor(() => {
      const cards = screen.getAllByRole("group", { name: "The Baker offers: Bread ×1" });
      expect(cards).toHaveLength(2);
      return cards[1]!;
    });
    fireEvent.click(within(second).getByRole("button", { name: "No, thanks" }));
    await waitFor(() => expect(within(second).getByRole("status").textContent).toBe("No deal."));
    expect(server.coins()).toBe(45);
    // Goodbye closes the panel.
    fireEvent.click(screen.getByRole("button", { name: /Goodbye/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sentTypes(server).slice(-2)).toEqual([ClientMessage.NpcEnd, ClientMessage.NpcMemory]);
  });

  it("redirects a native-language line gently and shows how to say it", async () => {
    const helpers: InputHelpers = {
      detectLanguage: async (text) => ({ ok: true, value: { lang: /thank/i.test(text) ? "en" : "es" }, source: "on-device" }),
      grammarFeedback: async () => ({ ok: true, value: { ok: false, better: "should not show" }, source: "on-device" }),
    };
    const { ai } = setup(helpers);
    standAtBaker();
    await act(async () => fireEvent.keyDown(window, { key: "f", code: "KeyF" }));
    const input = await screen.findByRole("textbox", { name: "Your reply in Spanish" });
    await waitFor(() => expect(active()).toBe(input));
    await type("thank you");
    await press("Enter");
    // Sent anyway (no grammar chip for a native line), with a soft note, and the NPC teaches the phrase.
    await waitFor(() => expect(ai.calls).toEqual(["thank you"]));
    expect(screen.queryByText(/should not show/)).toBeNull();
    await screen.findByText("The Baker answers in Spanish. Try writing in Spanish next time!");
    await screen.findByText("Here's how to say that: “Gracias”");
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    expect((input as HTMLInputElement).value).toBe("Gracias");
  });

  it("offers a starter fragment at B2 and a 💡 hint at C1+, which go into the reply box", async () => {
    // The Baker is a full level easier: a C1 player hears B2 (one starter fragment).
    setup(null, "C1");
    standAtBaker();
    fireEvent.click(screen.getByRole("button", { name: /Talk to the Baker/ }));
    const starter = await screen.findByRole("group", { name: "Finish this sentence" });
    const buttons = within(starter).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["¡Hola!"]);
    fireEvent.click(buttons[0]!);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("¡Hola!");
    cleanup();

    // The Librarian is harder: a C1 player hears C2, and the one reply waits behind the 💡.
    setup(null, "C1", "librarian");
    act(() => worldStore.setState({ space: "library", nearby: { id: "npc:librarian", kind: "npc" } }));
    fireEvent.click(screen.getByRole("button", { name: /Talk to the Librarian/ }));
    const hint = await screen.findByRole("button", { name: "💡 Show a hint" });
    expect(screen.queryByRole("group", { name: "Finish this sentence" })).toBeNull();
    fireEvent.click(hint);
    fireEvent.click(within(screen.getByRole("group", { name: "Finish this sentence" })).getByRole("button", { name: "¡Hola!" }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("¡Hola!");
  });
});

describe("NPC profile card (build plan M24)", () => {
  it("shows the hearts and takes a gift", async () => {
    const { server } = setup(null, "A1", "baker", { hearts: 2.25, contact: { greeting: 0.25, decay: 0 }, lastSeen: Date.UTC(2026, 10, 20), inventory: [{ itemId: "butter", qty: 2 }, { itemId: "fishing_rod", qty: 1 }] });
    standAtBaker();
    fireEvent.click(await screen.findByRole("button", { name: /Talk to the Baker/ }));
    const toggle = await screen.findByRole("button", { name: "About the Baker: 2.25 hearts" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const card = screen.getByRole("region", { name: /Baker/ });
    expect(within(card).getByRole("img", { name: "2.25 of 10 hearts" })).toBeTruthy();
    expect(card.textContent).toContain("Just met");
    expect(card.textContent).toContain("+0.25 ♥ for saying hello today");
    expect(card.textContent).toContain("Last talked:");
    // Tools are not offered as gifts.
    const gifts = within(card).getByRole("group", { name: "Give a gift" });
    expect(within(gifts).queryByRole("button", { name: /Fishing rod/ })).toBeNull();
    fireEvent.click(within(gifts).getByRole("button", { name: /Butter ×2/ }));
    await waitFor(() => expect(document.querySelector(".hv-convo__cards")?.textContent).toContain("The Baker loves the Butter! +1 ♥"));
    expect(server.sent.find((m) => m.type === ClientMessage.NpcGift)?.payload).toEqual({ conversationId: "conv-1", itemId: "butter" });
    expect(screen.getByRole("button", { name: "About the Baker: 3.25 hearts" })).toBeTruthy();
    expect(card.textContent).toContain("The Baker already got a gift today.");
  });
});
