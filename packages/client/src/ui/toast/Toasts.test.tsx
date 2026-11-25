// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createToastStore, MAX_TOASTS, TOAST_MS } from "../../state/toastStore";
import { Toasts } from "./Toasts";

/** The level toast (build plan M24, GDD §6.4). */
describe("Toasts", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("says the NPC thinks the player is improving, then goes", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    render(<Toasts store={store} />);
    act(() => void store.push({ kind: "level", npcId: "baker", direction: 1 }));
    expect(screen.getByRole("status").textContent).toContain("The Baker thinks you're improving! 🥐");
    act(() => void store.push({ kind: "level", npcId: "librarian", direction: -1 }));
    expect(screen.getByRole("status").textContent).toContain("The Librarian will keep things a little simpler for now. 📚");
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(store.getState().toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(TOAST_MS + 1));
    expect(store.getState().toasts).toHaveLength(0);
  });

  it("keeps at most a few", () => {
    const store = createToastStore();
    for (let i = 0; i < MAX_TOASTS + 2; i++) store.push({ kind: "level", npcId: "baker", direction: 1 });
    expect(store.getState().toasts).toHaveLength(MAX_TOASTS);
  });
});
