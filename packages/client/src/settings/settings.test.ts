// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// Node's own (file-less) localStorage shadows jsdom's; use the jsdom window's.
vi.hoisted(() => {
  const { window } = (globalThis as unknown as { jsdom: { window: Window } }).jsdom;
  Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true, writable: true });
});
import { isSettled, trackLoad, createLoadProgress } from "../assets/loadProgress";
import { actionForKey, DEFAULT_KEYMAP, GAME_ACTIONS, isReservedKey, keyLabel, matchesAction, parseKeymap, rebindKey } from "../input/keymap";
import { runHeld, screenDirection } from "../scene/playerMath";
import { dioramaStore } from "../state/dioramaStore";
import { LOADING_TIPS, TIP_LANGS, tipFor, tipLangFor } from "../ui/loading/tips";
import { DEFAULT_SETTINGS, parsePlayerSettings, reducesMotion, renderOptions } from "./playerSettings";
import { applySettings, createSettingsStore, LAST_SETTINGS_KEY, loadSettingsFor, readSettings, rebindAction, settingsKey, settingsStore, updateSettings } from "./settingsStore";

describe("keymap", () => {
  it("binds every action to its own key by default (GDD §10)", () => {
    expect(new Set(Object.values(DEFAULT_KEYMAP)).size).toBe(GAME_ACTIONS.length);
    expect(DEFAULT_KEYMAP.interact).toBe("KeyF");
    expect(matchesAction(DEFAULT_KEYMAP, "run", "ShiftRight")).toBe(true);
    expect(matchesAction(DEFAULT_KEYMAP, "chat", "NumpadEnter")).toBe(true);
    expect(matchesAction(DEFAULT_KEYMAP, "moveUp", "ArrowUp")).toBe(true);
    expect(actionForKey(DEFAULT_KEYMAP, "KeyJ")).toBe("quests");
    expect(actionForKey(DEFAULT_KEYMAP, "KeyZ")).toBeNull();
  });

  it("swaps on a conflict, so no action loses its key", () => {
    const r = rebindKey(DEFAULT_KEYMAP, "interact", "KeyE");
    expect(r.ok && r.keymap.interact).toBe("KeyE");
    expect(r.ok && r.swappedWith).toBe("rotateRight");
    expect(r.ok && r.keymap.rotateRight).toBe("KeyF");
    const plain = rebindKey(DEFAULT_KEYMAP, "interact", "KeyG");
    expect(plain.ok && plain.swappedWith).toBeNull();
  });

  it("keeps Escape, the arrows, the digits and function keys fixed", () => {
    for (const code of ["Escape", "ArrowLeft", "Digit3", "Numpad1", "F5", "MetaLeft"]) {
      expect(isReservedKey(code), code).toBe(true);
      expect(rebindKey(DEFAULT_KEYMAP, "interact", code)).toEqual({ ok: false, reason: "reserved" });
    }
  });

  it("parses saved keymaps defensively", () => {
    expect(parseKeymap(null)).toEqual(DEFAULT_KEYMAP);
    expect(parseKeymap({ interact: "KeyG", run: "ShiftRight", chat: "Escape", bogus: "KeyX" })).toEqual({ ...DEFAULT_KEYMAP, interact: "KeyG" });
    // A duplicate (two actions on one key) resets to the defaults.
    expect(parseKeymap({ interact: "KeyQ" })).toEqual(DEFAULT_KEYMAP);
  });

  it("labels keys", () => {
    expect(keyLabel("KeyF")).toBe("F");
    expect(keyLabel("ShiftRight")).toBe("Shift");
    expect(keyLabel("Digit7")).toBe("7");
    expect(keyLabel("Space")).toBe("Space");
  });

  it("walks and runs with remapped keys (the arrows keep working)", () => {
    const keymap = { ...DEFAULT_KEYMAP, moveUp: "KeyI", run: "KeyK" };
    expect(screenDirection(["KeyI"], keymap)).toEqual([0, 1]);
    expect(screenDirection(["KeyW"], keymap)).toEqual([0, 0]);
    expect(screenDirection(["ArrowUp"], keymap)).toEqual([0, 1]);
    expect(runHeld(["KeyK"], keymap)).toBe(true);
    expect(runHeld(["ShiftLeft"], keymap)).toBe(false);
  });
});

describe("player settings", () => {
  it("parses saved settings with defaults for anything missing or malformed", () => {
    expect(parsePlayerSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parsePlayerSettings({ textSize: "huge", accents: "colorblind", motion: "reduce", tiltShift: "yes", quality: "low", micButton: false })).toEqual({
      ...DEFAULT_SETTINGS,
      accents: "colorblind",
      motion: "reduce",
      quality: "low",
      micButton: false,
    });
  });

  it("reduces motion from the system unless forced, and then drops tilt-shift and camera easing", () => {
    expect(reducesMotion({ motion: "system" }, true)).toBe(true);
    expect(reducesMotion({ motion: "full" }, true)).toBe(false);
    expect(reducesMotion({ motion: "reduce" }, false)).toBe(true);
    expect(renderOptions(DEFAULT_SETTINGS, false)).toEqual({ effects: true, tiltShift: true, cameraEasing: true });
    expect(renderOptions(DEFAULT_SETTINGS, true)).toEqual({ effects: true, tiltShift: false, cameraEasing: false });
    expect(renderOptions({ ...DEFAULT_SETTINGS, quality: "low" }, false)).toEqual({ effects: false, tiltShift: false, cameraEasing: true });
  });
});

describe("settings store", () => {
  afterEach(() => {
    localStorage.clear();
    loadSettingsFor(null);
  });

  it("saves per player and as the device default, and applies to the document and renderer", () => {
    loadSettingsFor("u1");
    updateSettings({ textSize: "larger", accents: "colorblind", motion: "reduce" });
    expect(readSettings(settingsKey("u1")).textSize).toBe("larger");
    expect(readSettings(LAST_SETTINGS_KEY).accents).toBe("colorblind");
    expect(document.documentElement.dataset.hvTextSize).toBe("larger");
    expect(document.documentElement.style.getPropertyValue("--hv-text-scale")).toBe("1.3");
    expect(document.documentElement.dataset.hvAccents).toBe("colorblind");
    expect(document.documentElement.dataset.hvReducedMotion).toBe("");
    expect(dioramaStore.getState().tiltShift).toBe(false);
    // Another player on the same device starts from their own saved settings.
    loadSettingsFor("u2");
    expect(settingsStore.getState().settings.textSize).toBe("normal");
    loadSettingsFor("u1");
    expect(settingsStore.getState().settings.motion).toBe("reduce");
    updateSettings({ motion: "full", quality: "high" });
    expect(document.documentElement.dataset.hvReducedMotion).toBeUndefined();
    expect(dioramaStore.getState().tiltShift).toBe(true);
    expect(dioramaStore.getState().effects).toBe(true);
  });

  it("rebinds keys and survives broken storage", () => {
    loadSettingsFor("u1");
    expect(rebindAction("notebook", "KeyB").ok).toBe(true);
    expect(readSettings(settingsKey("u1")).keymap.notebook).toBe("KeyB");
    localStorage.setItem(settingsKey("u3"), "{not json");
    expect(readSettings(settingsKey("u3"))).toEqual(DEFAULT_SETTINGS);
    // A separate store does not touch the document.
    const other = createSettingsStore();
    updateSettings({ textSize: "largest" }, other);
    expect(other.getState().settings.textSize).toBe("largest");
    applySettings();
  });
});

describe("loading screen data", () => {
  it("has every tip in every featured language", () => {
    expect(TIP_LANGS).toEqual(["en", "es", "fr", "de", "it", "pt", "ja"]);
    for (const tip of LOADING_TIPS) for (const lang of TIP_LANGS) expect(tip[lang].length, lang).toBeGreaterThan(5);
  });

  it("shows the tip in the target language with the UI-language translation", () => {
    expect(tipLangFor("pt-BR")).toBe("pt");
    expect(tipLangFor("ko")).toBeNull();
    const ja = tipFor(0, "ja", "es");
    expect(ja.target).toEqual({ lang: "ja", text: LOADING_TIPS[0]!.ja });
    expect(ja.translation).toEqual({ lang: "es", text: LOADING_TIPS[0]!.es });
    expect(tipFor(0, "es", "es").translation).toBeNull();
    // No tips in Korean: the UI language alone.
    expect(tipFor(LOADING_TIPS.length + 1, "ko", "en")).toEqual({ target: null, translation: { lang: "en", text: LOADING_TIPS[1]!.en } });
  });

  it("counts loads and settles after a quiet moment", async () => {
    const store = createLoadProgress();
    expect(isSettled(store.getState(), 10_000, 600)).toBe(false);
    const a = trackLoad(Promise.resolve(1), store);
    const b = trackLoad(Promise.reject(new Error("404")), store);
    expect(store.getState().started).toBe(2);
    await a;
    await b.catch(() => {});
    expect(store.getState().finished).toBe(2);
    const at = store.getState().changedAt;
    expect(isSettled(store.getState(), at + 100, 600)).toBe(false);
    expect(isSettled(store.getState(), at + 700, 600)).toBe(true);
  });
});
