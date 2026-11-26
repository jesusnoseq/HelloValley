// @vitest-environment jsdom
import type { Room } from "@colyseus/sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BITE_WINDOW_MS,
  ClientMessage,
  type FishCastResultMessage,
  type FishResultMessage,
  minReelMs,
  REEL_PARAMS,
  type SaveWordDraft,
  ServerMessage,
  zoneCentre,
} from "@hellovalley/shared";
import type { BarkLine } from "../../ai/barks";
import { createElderBarks } from "../../ai/barks";
import type { TtsSpeaker } from "../../ai/tts";
import { I18nProvider } from "../../i18n/I18nProvider";
import { labelStore, setLabelLoader } from "../../labels/labelStore";
import { attachFishing, sendCast, sendReel } from "../../net/fishingSession";
import { createFishingStore, type FishingStore } from "../../state/fishingStore";
import { createInventoryStore } from "../../state/inventoryStore";
import { worldStore } from "../../state/worldStore";
import { onSaveWord } from "../speech/wordEvents";
import type { VoicePlayer } from "../speech/voicePlayer";
import { CatchCard } from "./CatchCard";
import { createFishingController } from "./controller";
import { FishBook } from "./FishBook";
import { FishingLayer, rodSlot } from "./FishingLayer";

/**
 * Build plan M27: the client steers a cast (hold to charge, hook in the bite window, reel the
 * mini-game) and shows what the server answered: the catch card with the fish's target-language
 * name, audio and notebook save, the Elder's cached comment, and the encyclopedia.
 */

function fakeRoom() {
  const handlers = new Map<string, (m: unknown) => void>();
  const sent: { type: string; payload: unknown }[] = [];
  const room = {
    connection: { isOpen: true },
    onMessage: (type: string, cb: (m: unknown) => void) => {
      handlers.set(type, cb);
      return () => handlers.delete(type);
    },
    send: (type: string, payload: unknown) => sent.push({ type, payload }),
  };
  return { room: room as unknown as Room, sent, emit: (type: string, m: unknown) => act(() => handlers.get(type)?.(m)) };
}

const DOCK: [number, number] = [53, 30.25];
const CAST: Extract<FishCastResultMessage, { ok: true }> = {
  ok: true,
  castId: "cast-1",
  spot: "dock",
  bobber: { x: 53, z: 27.5 },
  distance: 2.75,
  biteInMs: 3000,
  rarity: "common",
  shadow: "small",
  reelSeed: 77,
};
const CAUGHT: FishResultMessage = { castId: "cast-1", outcome: "caught", fishId: "carp", rarity: "common", first: true, kept: true, entry: { count: 1, firstMs: 1, lastMs: 1 }, elderNearby: true };

let store: FishingStore;
let net: ReturnType<typeof fakeRoom>;
let clock: number;

beforeEach(() => {
  store = createFishingStore();
  net = fakeRoom();
  clock = 1000;
  labelStore.setState({ byLang: {}, status: {} });
  setLabelLoader(async () => ({ labels: { "item.carp": { word: "carpa" } }, complete: true }));
});
afterEach(cleanup);

function controller() {
  attachFishing(net.room, store, () => clock);
  return createFishingController({
    store,
    sendCast: (m) => sendCast(m, net.room),
    sendReel: (m) => sendReel(m, net.room),
    rodSlot: () => 24,
    where: () => ({ pos: DOCK, heading: Math.PI }),
    canCast: () => true,
    now: () => clock,
  });
}

const sentOf = (type: string) => net.sent.filter((m) => m.type === type).map((m) => m.payload);

describe("fishing controls (build plan M27)", () => {
  it("charges by the hold, waits for the bite, hooks it and reels it in", () => {
    const c = controller();
    c.press();
    expect(store.getState()).toMatchObject({ phase: "charging" });
    expect(store.getState().heading).toBeCloseTo(Math.PI);
    clock += 600;
    c.release();
    expect(sentOf(ClientMessage.FishCast)).toEqual([{ slot: 24, charge: 0.5, heading: store.getState().heading }]);
    expect(store.getState().phase).toBe("casting");

    net.emit(ServerMessage.FishCast, CAST);
    expect(store.getState()).toMatchObject({ phase: "waiting", biteAtMs: clock + 3000 });
    clock += 2999;
    c.tick();
    expect(store.getState().phase).toBe("waiting");
    clock += 1;
    c.tick();
    expect(store.getState().phase).toBe("bite");
    clock += 200;
    c.press();
    expect(store.getState().phase).toBe("reeling");

    // Steer the bobber toward the zone until the fish is landed.
    const params = REEL_PARAMS.common;
    for (let i = 0; i < 2000 && store.getState().phase === "reeling"; i++) {
      const reel = store.getState().reel!;
      if (reel.pos + reel.vel * 0.25 < zoneCentre(reel.t + 0.15, params, CAST.reelSeed)) c.press();
      else c.release();
      clock += 1000 / 60;
      c.tick();
    }
    expect(store.getState().phase).toBe("landing");
    expect(store.getState().reel!.t * 1000).toBeGreaterThanOrEqual(minReelMs("common") - 1);
    expect(sentOf(ClientMessage.FishReel)).toEqual([{ castId: "cast-1", outcome: "caught" }]);

    net.emit(ServerMessage.FishResult, CAUGHT);
    expect(store.getState()).toMatchObject({ phase: "result", result: CAUGHT });
    c.closeResult();
    expect(store.getState().phase).toBe("idle");
  });

  it("spooks the fish when hooking too early or too late, and reels in on Escape", () => {
    const c = controller();
    const castOnce = () => {
      c.press();
      c.release();
      net.emit(ServerMessage.FishCast, CAST);
    };
    castOnce();
    c.press();
    expect(store.getState()).toMatchObject({ phase: "idle", notice: "early" });
    castOnce();
    clock += CAST.biteInMs;
    c.tick();
    clock += BITE_WINDOW_MS.common + 1;
    c.tick();
    expect(store.getState()).toMatchObject({ phase: "idle", notice: "late" });
    castOnce();
    c.cancel();
    expect(store.getState()).toMatchObject({ phase: "idle", notice: "escaped" });
    expect(sentOf(ClientMessage.FishReel)).toEqual([
      { castId: "cast-1", outcome: "escaped" },
      { castId: "cast-1", outcome: "escaped" },
      { castId: "cast-1", outcome: "escaped" },
    ]);
    // A refused cast says why.
    c.press();
    c.release();
    net.emit(ServerMessage.FishCast, { ok: false, reason: "cooldown" });
    expect(store.getState()).toMatchObject({ phase: "idle", notice: "cooldown" });
    // The encyclopedia comes from the server.
    net.emit(ServerMessage.FishLog, { species: { carp: { count: 2, firstMs: 1, lastMs: 2 } } });
    expect(store.getState()).toMatchObject({ logLoaded: true, log: { carp: { count: 2 } } });
  });

  it("equips only the rod in hand", () => {
    const inv = createInventoryStore();
    inv.setState({ slots: [{ slot: 24, itemId: "fishing_rod", qty: 1 }, { slot: 25, itemId: "bread", qty: 1 }], selected: 25 });
    expect(rodSlot(inv.getState())).toBeNull();
    inv.setState({ selected: 24 });
    expect(rodSlot(inv.getState())).toBe(24);
  });
});

const silentTts: TtsSpeaker = { clip: async () => ({ ok: false, reason: "unavailable" }) };
const silentPlayer: VoicePlayer = { play: async () => undefined, stop: () => undefined } as unknown as VoicePlayer;

describe("catch card and fish book (build plan M27)", () => {
  it("names the fish in the target language, saves it to the notebook and shows the Elder's comment", async () => {
    store.setState({ phase: "result", result: CAUGHT });
    const saved: SaveWordDraft[] = [];
    const off = onSaveWord((d) => saved.push(d));
    const bark = vi.fn(async (): Promise<BarkLine> => ({ text: "¡Buena carpa, joven!", translation: "Good carp, youngster!" }));
    render(
      <I18nProvider locale="en">
        <CatchCard store={store} lang="es" nativeLang="en" onClose={() => undefined} bark={bark} tts={silentTts} player={silentPlayer} />
      </I18nProvider>,
    );
    expect(screen.getByRole("dialog", { name: "You caught a fish!" })).toBeTruthy();
    expect(await screen.findByText("carpa")).toBeTruthy();
    expect(screen.getByText("New species!")).toBeTruthy();
    expect(screen.getByText("Added to your bag.")).toBeTruthy();
    expect(await screen.findByText("¡Buena carpa, joven!")).toBeTruthy();
    expect(bark).toHaveBeenCalledWith({ fishId: "carp", targetLang: "es", nativeLang: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Save to notebook" }));
    expect(saved).toEqual([{ lang: "es", surface: "carpa", example: "carpa", source: "object:item.carp" }]);
    off();
  });

  it("stays quiet without the Elder nearby, and lists caught and missing species", async () => {
    store.setState({ phase: "result", result: { ...CAUGHT, elderNearby: false, first: false, kept: false }, log: { carp: { count: 3, firstMs: 1, lastMs: 3 } }, bookOpen: true });
    const bark = vi.fn(async () => null);
    render(
      <I18nProvider locale="en">
        <CatchCard store={store} lang="es" nativeLang="en" onClose={() => undefined} bark={bark} tts={silentTts} player={silentPlayer} />
        <FishBook store={store} lang="es" nativeLang="en" />
      </I18nProvider>,
    );
    expect(screen.getByText("Your bag is full, so you let it go.")).toBeTruthy();
    expect(bark).not.toHaveBeenCalled();
    expect(screen.getByText("1 of 18 species")).toBeTruthy();
    const carp = document.querySelector('[data-fish="carp"]')!;
    await vi.waitFor(() => expect(carp.textContent).toContain("carpa"));
    expect(carp.textContent).toContain("×3");
    expect(document.querySelector('[data-fish="ghost_pike"]')!.textContent).toContain("Not caught yet");
    expect(document.querySelector('[data-fish="ghost_pike"]')!.textContent).toContain("night · fog · Secret spot");
    fireEvent.keyDown(window, { code: "Escape" });
    expect(store.getState().bookOpen).toBe(false);
  });

  it("shows the cast hint with the rod in hand at a fishing spot and casts with Space", () => {
    const inv = createInventoryStore();
    inv.setState({ status: "ready", slots: [{ slot: 24, itemId: "fishing_rod", qty: 1 }], selected: 24 });
    worldStore.setState({ space: "town", fishingSpot: "dock" });
    const press = vi.fn();
    const release = vi.fn();
    render(
      <I18nProvider locale="en">
        <FishingLayer store={store} inventory={inv} controller={{ press, release, cancel: vi.fn(), tick: vi.fn(), closeResult: vi.fn() }} />
      </I18nProvider>,
    );
    expect(screen.getByText(/Hold Space to cast/)).toBeTruthy();
    fireEvent.keyDown(window, { code: "Space" });
    fireEvent.keyUp(window, { code: "Space" });
    expect(press).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    act(() => worldStore.setState({ fishingSpot: null }));
    expect(screen.getByText("Walk to the dock or the river bank to fish.")).toBeTruthy();
    worldStore.setState({ fishingSpot: null });
  });
});

describe("the Elder's barks (build plan M27)", () => {
  it("prefers the seeded line, else generates one for this player", async () => {
    const generate = vi.fn(async () => ({ ok: true as const, source: "cloud" as const, value: { lines: [{ text: "Generated", translation: "G" }] } }));
    const seeded = createElderBarks({ seeded: async () => ({ text: "¡Qué carpa!", translation: { en: "What a carp!" } }), generate });
    expect(await seeded.get({ fishId: "carp", targetLang: "es", nativeLang: "en" })).toEqual({ text: "¡Qué carpa!", translation: "What a carp!" });
    expect(generate).not.toHaveBeenCalled();
    const miss = createElderBarks({ seeded: async () => null, generate, random: () => 0 });
    expect(await miss.get({ fishId: "carp", targetLang: "es", nativeLang: "en" })).toEqual({ text: "Generated", translation: "G" });
    expect(generate).toHaveBeenCalledWith({ targetLang: "es", nativeLang: "en", fishEnglish: "Carp", rarity: "common", fishId: "carp" });
    const none = createElderBarks({ generate: async () => ({ ok: false, reason: "unavailable" }) });
    expect(await none.get({ fishId: "carp", targetLang: "es", nativeLang: "en" })).toBeNull();
  });
});
