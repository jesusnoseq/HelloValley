// @vitest-environment jsdom
import type { Room } from "@colyseus/sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMessage, type PlayerProfile } from "@hellovalley/shared";
import { I18nProvider } from "../../i18n/I18nProvider";
import { labelStore, setLabelLoader } from "../../labels/labelStore";
import { sendPick } from "../../net/forageSession";
import { avatarStore } from "../../state/avatarStore";
import { createForageStore, type ForageStore } from "../../state/forageStore";
import { worldStore } from "../../state/worldStore";
import { ForageAlbum } from "./ForageAlbum";
import { ForageLayer } from "./ForageLayer";

/**
 * Build plan M28: the pick-up hint names the spawn in the target language and sends `forage:pick`,
 * the server's answer shows as a notice (finds, lost items, refusals), and the album lists what
 * the server says was found and returned.
 */

const profile = { name: "Lia", targetLangs: ["es"], nativeLang: "en" } as unknown as PlayerProfile;
let store: ForageStore;

beforeEach(() => {
  store = createForageStore();
  labelStore.setState({ byLang: {}, status: {} });
  setLabelLoader(async () => ({ labels: { "item.daisy": { word: "margarita" }, "item.lost_glasses": { word: "gafas" } }, complete: true }));
  avatarStore.setState({ profile });
  worldStore.setState({ space: "town" });
});
afterEach(() => {
  cleanup();
  avatarStore.setState({ profile: null });
});

const ui = (pick = vi.fn(() => true)) => {
  render(
    <I18nProvider locale="en">
      <ForageLayer store={store} pick={pick} />
    </I18nProvider>,
  );
  return pick;
};

describe("forage layer (build plan M28)", () => {
  it("names the spawn within reach and picks it up", async () => {
    store.setState({ spawns: { "d1-0": { spawnId: "d1-0", itemId: "daisy", kind: "forage", x: 1, z: 2, pos: [1, 2] } }, nearby: "d1-0" });
    const pick = ui();
    expect(await screen.findByText("margarita")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick up (F)" }));
    expect(pick).toHaveBeenCalledWith("d1-0");
  });

  it("shows what the server answered", async () => {
    ui();
    act(() => store.setState({ last: { spawnId: "d1-0", ok: true, itemId: "daisy", kind: "forage", first: true, entry: { count: 1, firstMs: 1, lastMs: 1 } } }));
    expect(await screen.findByText(/\+1 margarita · New in your album!/)).toBeTruthy();
    act(() => store.setState({ last: { spawnId: "d1-9", ok: true, itemId: "lost_glasses", kind: "lost", first: true, entry: { count: 1, firstMs: 1, lastMs: 1 } } }));
    expect(await screen.findByText(/You found the Librarian's gafas! Bring it back to them./)).toBeTruthy();
    act(() => store.setState({ last: { spawnId: "d1-3", ok: false, reason: "taken" } }));
    expect(screen.getByText("Someone got there first.")).toBeTruthy();
  });

  it("sends forage:pick once at a time", () => {
    const sent: { type: string; payload: unknown }[] = [];
    const room = { connection: { isOpen: true }, send: (type: string, payload: unknown) => sent.push({ type, payload }) } as unknown as Room;
    expect(sendPick("d1-0", store, room)).toBe(true);
    expect(sendPick("d1-1", store, room)).toBe(false);
    expect(sent).toEqual([{ type: ClientMessage.ForagePick, payload: { spawnId: "d1-0" } }]);
  });

  it("lists found and missing items and returned lost items in the album", async () => {
    store.setState({
      album: { found: { daisy: { count: 3, firstMs: 1, lastMs: 3 }, lost_glasses: { count: 1, firstMs: 1, lastMs: 1 } }, returned: { lost_glasses: { count: 1, lastDay: 4 } } },
      albumLoaded: true,
      albumOpen: true,
    });
    render(
      <I18nProvider locale="en">
        <ForageAlbum store={store} lang="es" nativeLang="en" />
      </I18nProvider>,
    );
    expect(screen.getByText("1 of 14 finds")).toBeTruthy();
    const daisy = document.querySelector('[data-item="daisy"]')!;
    await vi.waitFor(() => expect(daisy.textContent).toContain("margarita"));
    expect(daisy.textContent).toContain("×3");
    expect(document.querySelector('[data-item="poppy"]')!.textContent).toContain("Not found yet");
    expect(document.querySelector('[data-item="lost_glasses"]')!.textContent).toContain("Returned ×1");
    expect(document.querySelector('[data-item="lost_hat"]')!.textContent).toContain("Belongs to the Farmer");
    fireEvent.keyDown(window, { code: "Escape" });
    expect(store.getState().albumOpen).toBe(false);
  });
});
