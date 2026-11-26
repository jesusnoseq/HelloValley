// @vitest-environment jsdom
import type { Room } from "@colyseus/sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMessage, HOTBAR_FIRST_SLOT, type PlayerProfile, ServerMessage } from "@hellovalley/shared";
import { npcContextFixture } from "../../../../shared/src/npc/fixtures";
import { I18nProvider } from "../../i18n/I18nProvider";
import { labelStore, setLabelLoader } from "../../labels/labelStore";
import { attachFood, sendCook, sendEat, sendSit, sendStand } from "../../net/foodSession";
import { avatarStore } from "../../state/avatarStore";
import { createConversationStore } from "../../state/conversationStore";
import { createFoodStore, type FoodStore, localSpeedFactor } from "../../state/foodStore";
import { createInventoryStore, type InventoryStore } from "../../state/inventoryStore";
import { worldStore } from "../../state/worldStore";
import { ConversationController } from "../conversation/controller";
import { fakeBakerReply, fakeNpcAi, fakeNpcServer } from "../conversation/fakeNpc";
import { FoodLayer } from "./FoodLayer";

/**
 * Build plan M29 on the client: the food session mirrors the server's buffs, recipe book, bites
 * and seat; the food layer eats the item held in the hotbar (button or Space), shows the buff in
 * the HUD while it runs, offers the seat and the kitchen, and the kitchen shows the learned
 * recipes as cards in the target language with a Cook button; the coffee's extra hint shows one
 * more suggested reply, once per conversation.
 */

const H = HOTBAR_FIRST_SLOT;
const profile = { name: "Lia", targetLangs: ["es"], nativeLang: "en" } as unknown as PlayerProfile;
let store: FoodStore;
let inventory: InventoryStore;

/** A room that records what is sent and lets the test deliver server messages. */
function fakeRoom() {
  const handlers = new Map<string, (msg: unknown) => void>();
  const sent: { type: string; payload: unknown }[] = [];
  const room = {
    sessionId: "me",
    connection: { isOpen: true },
    send: (type: string, payload: unknown) => sent.push({ type, payload }),
    onMessage: (type: string, cb: (msg: unknown) => void) => {
      handlers.set(type, cb);
      return () => handlers.delete(type);
    },
  } as unknown as Room;
  return { room, sent, emit: (type: string, msg: unknown) => handlers.get(type)?.(msg) };
}

beforeEach(() => {
  store = createFoodStore();
  inventory = createInventoryStore();
  labelStore.setState({ byLang: {}, status: {} });
  setLabelLoader(async () => ({
    labels: {
      "item.bread": { word: "pan" },
      "item.flour": { word: "harina" },
      "item.milk": { word: "leche" },
      "recipe.card": { word: "receta" },
      "recipe.ingredients": { word: "ingredientes" },
      "recipe.method": { word: "preparación" },
      "recipe.step.mix": { word: "mezclar" },
      "recipe.step.knead": { word: "amasar" },
      "recipe.step.bake": { word: "hornear" },
    },
    complete: true,
  }));
  avatarStore.setState({ profile });
  worldStore.setState({ space: "apartment", nearby: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  avatarStore.setState({ profile: null });
});

const ui = (o: { now?: () => number } = {}) => {
  const fns = { eat: vi.fn(() => true), cook: vi.fn(() => true), sit: vi.fn(() => true), stand: vi.fn(() => true) };
  render(
    <I18nProvider locale="en">
      <FoodLayer store={store} inventory={inventory} {...fns} {...(o.now ? { now: o.now } : {})} />
    </I18nProvider>,
  );
  return fns;
};

const bread = { slot: H, itemId: "bread" as const, qty: 1 };

describe("food session (build plan M29)", () => {
  it("mirrors the server's buffs, book, bites and seat", () => {
    const r = fakeRoom();
    const detach = attachFood(r.room, store, () => 1000);
    r.emit(ServerMessage.Buffs, { buffs: [{ kind: "walk_speed", amount: 0.1, itemId: "bread", remainingMs: 300_000, durationMs: 300_000 }] });
    expect(store.getState().buffs).toEqual([{ kind: "walk_speed", amount: 0.1, itemId: "bread", endsAt: 301_000, durationMs: 300_000 }]);
    expect(localSpeedFactor(store.getState(), 2000)).toBeCloseTo(1.1);
    expect(localSpeedFactor(store.getState(), 301_000)).toBe(1);
    r.emit(ServerMessage.RecipeBook, { book: { known: { bread: { teacher: "baker", lang: "es", learnedMs: 1, cooked: 0 } } } });
    expect(store.getState()).toMatchObject({ bookLoaded: true, book: { known: { bread: { teacher: "baker" } } } });
    r.emit(ServerMessage.FoodEaten, { slot: H, ok: true, itemId: "bread", buff: null, emote: null });
    expect(store.getState().eatingUntil).toBeGreaterThan(1000);
    r.emit(ServerMessage.SeatState, { seatId: "bench-0a" });
    expect(store.getState().seat).toBe("bench-0a");
    r.emit(ServerMessage.SeatState, { seatId: null, refused: "taken" });
    expect(store.getState()).toMatchObject({ seat: null, seatRefused: "taken" });
    detach();
    expect(store.getState().buffs).toEqual([]);
  });

  it("sends bites, dishes and seats (one bite at a time)", () => {
    const r = fakeRoom();
    expect(sendEat(H, store, r.room)).toBe(true);
    expect(sendEat(H, store, r.room)).toBe(false);
    expect(sendCook("bread", store, r.room)).toBe(true);
    expect(sendSit("bench-0a", store, r.room)).toBe(true);
    expect(sendStand(store, r.room)).toBe(false); // not seated
    store.setState({ seat: "bench-0a" });
    expect(sendStand(store, r.room)).toBe(true);
    expect(store.getState().seat).toBeNull();
    expect(r.sent).toEqual([
      { type: ClientMessage.FoodEat, payload: { slot: H } },
      { type: ClientMessage.CookMake, payload: { recipeId: "bread" } },
      { type: ClientMessage.SeatSit, payload: { seatId: "bench-0a" } },
      { type: ClientMessage.SeatStand, payload: {} },
    ]);
  });
});

describe("food layer (build plan M29)", () => {
  it("acceptance: eats the bread in hand and shows the buff in the HUD until it runs out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let now = 10_000;
    inventory.setState({ status: "ready", slots: [bread], selected: H });
    const { eat } = ui({ now: () => now });
    // The target-language word on the button; a click and Space both eat.
    const button = await screen.findByRole("button", { name: /Eat pan \(Space\)/ });
    fireEvent.click(button);
    fireEvent.keyDown(window, { code: "Space" });
    expect(eat).toHaveBeenCalledTimes(2);
    expect(eat).toHaveBeenCalledWith(H);

    // The server's answer and buff.
    act(() =>
      store.setState({
        lastEaten: { slot: H, ok: true, itemId: "bread", buff: null, emote: null },
        buffs: [{ kind: "walk_speed", amount: 0.1, itemId: "bread", endsAt: now + 300_000, durationMs: 300_000 }],
      }),
    );
    expect(screen.getByText("Yum! pan")).toBeTruthy();
    const hud = screen.getByRole("list", { name: "Active effects" });
    expect(hud.textContent).toContain("+10 % speed");
    expect(hud.textContent).toContain("5:00");
    // It counts down, then leaves the HUD.
    now += 61_000;
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(screen.getByRole("list", { name: "Active effects" }).textContent).toContain("3:59");
    now += 300_000;
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("list", { name: "Active effects" })).toBeNull();
  });

  it("does not offer to eat a tool, and Space is left alone then", () => {
    inventory.setState({ status: "ready", slots: [{ slot: H, itemId: "fishing_rod", qty: 1 }], selected: H });
    const { eat } = ui();
    expect(screen.queryByRole("button", { name: /Eat/ })).toBeNull();
    fireEvent.keyDown(window, { code: "Space" });
    expect(eat).not.toHaveBeenCalled();
  });

  it("explains a refused bite and a refused seat", () => {
    ui();
    act(() => store.setState({ lastEaten: { slot: H, ok: false, reason: "not_food" } }));
    expect(screen.getByText("You can't eat that!")).toBeTruthy();
    act(() => store.setState({ lastEaten: null, seatRefused: "taken" }));
    expect(screen.getByText("Someone is already sitting there.")).toBeTruthy();
  });

  it("offers the seat in reach, and standing up once seated", () => {
    const { sit, stand } = ui();
    act(() => store.setState({ nearbySeat: "cafe-chair-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Sit down \(F\)/ }));
    expect(sit).toHaveBeenCalledWith("cafe-chair-1");
    act(() => store.setState({ seat: "cafe-chair-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Stand up \(F\)/ }));
    expect(stand).toHaveBeenCalled();
  });

  it("acceptance: the kitchen shows the learned recipe as a card in the target language and cooks it", async () => {
    store.setState({ book: { known: { bread: { teacher: "baker", lang: "es", learnedMs: 1, cooked: 0 } } }, bookLoaded: true });
    inventory.setState({ status: "ready", slots: [{ slot: 0, itemId: "flour", qty: 1 }, { slot: 1, itemId: "milk", qty: 1 }] });
    act(() => worldStore.setState({ nearby: { id: "apartment:kitchen", kind: "kitchen" } }));
    const { cook } = ui();
    fireEvent.click(screen.getByRole("button", { name: /Cook \(F\)/ }));
    const kitchen = await screen.findByRole("dialog", { name: /Kitchen/ });
    // Every word on the card is the target language.
    for (const word of ["pan", "receta", "ingredientes", "harina", "leche", "preparación", "mezclar", "amasar", "hornear"]) expect(await screen.findByText(word)).toBeTruthy();
    expect(kitchen.textContent).toContain("Taught by the Baker");
    expect(kitchen.textContent).toContain("6 more recipes to learn");
    // One flour short: Cook is disabled until the bag has two.
    const cookButton = screen.getByRole("button", { name: "Cook: pan" }) as HTMLButtonElement;
    expect(cookButton.disabled).toBe(true);
    act(() => inventory.setState({ slots: [{ slot: 0, itemId: "flour", qty: 2 }, { slot: 1, itemId: "milk", qty: 1 }] }));
    expect((screen.getByRole("button", { name: "Cook: pan" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cook: pan" }));
    expect(cook).toHaveBeenCalledWith("bread");
    act(() => store.setState({ lastCooked: { recipeId: "bread", ok: true, itemId: "bread", uses: [] } }));
    expect(screen.getByText("You made pan!")).toBeTruthy();
    // Escape closes it; walking away does too.
    fireEvent.keyDown(window, { code: "Escape" });
    expect(store.getState().kitchenOpen).toBe(false);
    act(() => store.setState({ kitchenOpen: true }));
    act(() => worldStore.setState({ nearby: null }));
    expect(store.getState().kitchenOpen).toBe(false);
  });

  it("says when no recipe is known yet", () => {
    act(() => worldStore.setState({ nearby: { id: "apartment:kitchen", kind: "kitchen" } }));
    store.setState({ kitchenOpen: true });
    ui();
    expect(screen.getByText(/You don't know any recipes yet/)).toBeTruthy();
  });
});

describe("the coffee's extra hint in a conversation (build plan M29)", () => {
  it("holds back one more suggestion until revealed, once per conversation", async () => {
    const ctx = { ...npcContextFixture({ lang: "es", playerLevel: "A1" }), extraHints: 1 };
    const server = fakeNpcServer(ctx);
    const four = [
      { text: "Sí, por favor.", translation: "Yes, please." },
      { text: "¿Cuánto cuesta?", translation: "How much is it?" },
      { text: "No, gracias.", translation: "No, thank you." },
      { text: "¿Tienes croissants?", translation: "Do you have croissants?" },
    ];
    const ai = fakeNpcAi(() => ({ ...fakeBakerReply("¿Qué?"), suggestedReplies: four }));
    const convo = createConversationStore();
    const controller = new ConversationController(
      { room: () => server.room, ai: async () => ai, helpers: async () => null, player: () => ({ name: "Lia", animal: "fox", apartmentId: "3B" }), checkTimeoutMs: 20, toast: () => undefined },
      convo,
    );
    await controller.open("baker");
    expect(convo.getState().extraHint).toBe("available");
    await controller.submit("Hola", "suggested");
    await new Promise((r) => setTimeout(r, 20));
    expect(convo.getState().suggestions).toHaveLength(4);
    controller.revealExtraHint();
    expect(convo.getState().extraHint).toBe("shown");
    await controller.submit("Sí, por favor.", "suggested");
    await new Promise((r) => setTimeout(r, 20));
    expect(convo.getState().extraHint).toBe("used");
    controller.revealExtraHint();
    expect(convo.getState().extraHint).toBe("used");
  });
});
