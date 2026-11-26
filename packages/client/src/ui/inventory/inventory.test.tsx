// @vitest-environment jsdom
import type { Room } from "@colyseus/sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMessage, type InventoryStateMessage, ServerMessage } from "@hellovalley/shared";
import { I18nProvider } from "../../i18n/I18nProvider";
import { labelStore, setLabelLoader } from "../../labels/labelStore";
import { attachInventory, moveInventory } from "../../net/inventorySession";
import { createInventoryStore, type InventoryStore } from "../../state/inventoryStore";
import { InventoryLayer } from "./InventoryLayer";

/**
 * Build plan M26: the hotbar and the bag (Tab) mirror the server's `inventory:state`, show items
 * by their target-language word, and send `inventory:move` for click, drag and keyboard moves.
 */

function fakeRoom() {
  const handlers = new Map<string, (m: unknown) => void>();
  const sent: { type: string; payload: unknown }[] = [];
  const room = {
    onMessage: (type: string, cb: (m: unknown) => void) => {
      handlers.set(type, cb);
      return () => handlers.delete(type);
    },
    send: (type: string, payload: unknown) => sent.push({ type, payload }),
  };
  return { room: room as unknown as Room, sent, emit: (type: string, m: unknown) => act(() => handlers.get(type)?.(m)), handlers };
}

const STATE: InventoryStateMessage = {
  lang: "ja",
  coins: 42,
  slots: [
    { slot: 0, itemId: "bread", qty: 2 },
    { slot: 1, itemId: "daisy", qty: 5 },
    { slot: 25, itemId: "fishing_rod", qty: 1 },
  ],
};

let store: InventoryStore;
let net: ReturnType<typeof fakeRoom>;

beforeEach(() => {
  store = createInventoryStore();
  net = fakeRoom();
  labelStore.setState({ byLang: {}, status: {} });
  setLabelLoader(async () => ({ labels: { "item.bread": { word: "パン", reading: "pan" }, "item.daisy": { word: "ひなぎく" } }, complete: true }));
});
afterEach(cleanup);

function show(locale: "en" | "es" = "en") {
  attachInventory(net.room, store);
  const move = vi.fn((from: number, to: number) => void moveInventory(from, to, store, net.room));
  render(
    <I18nProvider locale={locale}>
      <InventoryLayer store={store} move={move} />
    </I18nProvider>,
  );
  return move;
}

const slot = (n: number) => document.querySelector<HTMLButtonElement>(`[data-slot="${n}"]`)!;
const labelsReady = () => vi.waitFor(() => expect(labelStore.getState().status.ja).toBe("ready"));
const moves = () => net.sent.filter((m) => m.type === ClientMessage.InventoryMove).map((m) => m.payload);

describe("inventory UI (build plan M26)", () => {
  it("shows the server's coins and the hotbar, and opens the bag with Tab in the target language", async () => {
    show();
    expect(screen.getByRole("toolbar", { name: "Hotbar" }).textContent).toContain("…");
    net.emit(ServerMessage.InventoryState, STATE);
    expect(screen.getByRole("toolbar", { name: "Hotbar" }).textContent).toContain("42");
    // The rod sits in hotbar slot 25.
    expect(slot(25).getAttribute("aria-label")).toBe("Fishing rod ×1");

    fireEvent.keyDown(window, { code: "Tab", key: "Tab" });
    const bag = await screen.findByRole("dialog", { name: /Bag/ });
    expect(bag.textContent).toContain("42 coins");
    await vi.waitFor(() => expect(slot(0).getAttribute("aria-label")).toBe("パン (bread) ×2"));
    expect(slot(0).textContent).toContain("パン");
    expect(slot(0).title).toContain("pan");
    expect(slot(1).textContent).toContain("ひなぎく");
    expect(slot(1).textContent).toContain("5");
    expect(slot(2).getAttribute("aria-label")).toBe("Empty slot");
    // Focus starts on the first slot; Escape closes.
    expect(document.activeElement).toBe(slot(0));
    fireEvent.keyDown(slot(0), { code: "Escape", key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves a stack by clicking it and then the target, previewing and then taking the server's answer", async () => {
    const move = show();
    net.emit(ServerMessage.InventoryState, STATE);
    await labelsReady();
    act(() => store.setState({ open: true }));
    fireEvent.click(slot(0));
    expect(slot(0).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Moving");
    fireEvent.click(slot(24));
    expect(move).toHaveBeenCalledWith(0, 24);
    expect(moves()).toEqual([{ from: 0, to: 24, moveId: expect.any(Number) }]);
    // The preview shows at once.
    expect(slot(24).textContent).toContain("パン");
    expect(slot(0).getAttribute("aria-label")).toBe("Empty slot");
    // The server disagrees (say, another tab sold the bread): its answer wins.
    const moveId = (moves()[0] as { moveId: number }).moveId;
    net.emit(ServerMessage.InventoryState, { ...STATE, slots: STATE.slots.slice(1), moveId, refused: "empty_slot" });
    expect(slot(24).getAttribute("aria-label")).toBe("Empty slot");
    expect(screen.getByRole("status").textContent).toBe("That slot is empty.");
    // Clicking an empty slot picks nothing up; clicking a held stack again puts it back.
    fireEvent.click(slot(5));
    expect(moves()).toHaveLength(1);
    fireEvent.click(slot(1));
    fireEvent.click(slot(1));
    expect(slot(1).getAttribute("aria-pressed")).toBe("false");
  });

  it("moves by drag and drop and by keyboard alone", async () => {
    show();
    net.emit(ServerMessage.InventoryState, STATE);
    await labelsReady();
    fireEvent.keyDown(window, { code: "Tab", key: "Tab" });
    fireEvent.dragStart(slot(1));
    fireEvent.dragOver(slot(3));
    fireEvent.drop(slot(3));
    expect(moves()).toEqual([{ from: 1, to: 3, moveId: expect.any(Number) }]);
    expect(slot(3).textContent).toContain("ひなぎく");

    // Keyboard: arrows move the focus (rows of 6; the hotbar is the last row), Enter picks up and puts down.
    expect(document.activeElement).toBe(slot(0));
    fireEvent.keyDown(slot(0), { key: "Enter" });
    fireEvent.click(slot(0)); // Enter on a button clicks it
    fireEvent.keyDown(slot(0), { key: "ArrowDown" });
    expect(document.activeElement).toBe(slot(6));
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(slot(24));
    fireEvent.keyDown(slot(24), { key: "ArrowRight" });
    expect(document.activeElement).toBe(slot(25));
    // Left from the first slot of a row stays put.
    fireEvent.keyDown(slot(24), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(slot(25));
    fireEvent.click(slot(26));
    expect(moves().at(-1)).toEqual({ from: 0, to: 26, moveId: expect.any(Number) });
  });

  it("selects a hotbar item with the bag closed, and leaves Tab alone in text boxes", () => {
    show();
    net.emit(ServerMessage.InventoryState, STATE);
    fireEvent.click(slot(25));
    expect(slot(25).getAttribute("aria-pressed")).toBe("true");
    expect(store.getState().selected).toBe(25);
    expect(screen.getByRole("status").textContent).toContain("Fishing rod");
    fireEvent.click(slot(25));
    expect(store.getState().selected).toBeNull();
    expect(moves()).toEqual([]);

    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { code: "Tab", key: "Tab" });
    expect(store.getState().open).toBe(false);
    // Nor inside another panel's buttons.
    const other = document.createElement("button");
    document.body.append(other);
    fireEvent.keyDown(other, { code: "Tab", key: "Tab" });
    expect(store.getState().open).toBe(false);
    input.remove();
    other.remove();
  });

  it("goes back to offline when the room is left, and sends nothing without a room", () => {
    const detach = attachInventory(net.room, store);
    net.emit(ServerMessage.InventoryState, STATE);
    expect(store.getState()).toMatchObject({ status: "ready", coins: 42, lang: "ja" });
    detach();
    expect(store.getState()).toMatchObject({ status: "offline", coins: null, slots: [] });
    expect(net.handlers.has(ServerMessage.InventoryState)).toBe(false);
    expect(moveInventory(0, 1, store, null)).toBe(false);
  });

  it("speaks the UI language without English names for non-English players", async () => {
    show("es");
    net.emit(ServerMessage.InventoryState, STATE);
    fireEvent.keyDown(window, { code: "Tab", key: "Tab" });
    await screen.findByRole("dialog", { name: /Bolsa/ });
    await vi.waitFor(() => expect(slot(0).getAttribute("aria-label")).toBe("パン ×2"));
  });
});
