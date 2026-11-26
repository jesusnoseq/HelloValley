import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { type GameAction, matchesAction, rebindKey, type RebindResult } from "../input/keymap";
import { dioramaStore } from "../state/dioramaStore";
import { DEFAULT_SETTINGS, parsePlayerSettings, type PlayerSettings, reducesMotion, renderOptions, TEXT_SIZES } from "./playerSettings";

/**
 * The player's accessibility and display settings (build plan M37). Saved per player in this
 * browser's localStorage (`hv-settings-<uid>`), like the volumes (M35); the last player's settings
 * are also the device default (`hv-settings-last`), so the sign-in screen already uses them.
 * Every storage access is wrapped: private mode or blocked storage keeps the defaults.
 *
 * Applying them sets attributes on <html> that the global stylesheet (ui/theme.css) reads (text
 * size, accent palette, reduced motion) and the renderer flags in the diorama store
 * (post-processing, tilt-shift); the camera reads `cameraEasing` every frame.
 */

export interface SettingsState {
  uid: string | null;
  settings: PlayerSettings;
  /** Whether the system asks for reduced motion (`prefers-reduced-motion`). */
  systemReducedMotion: boolean;
}

export type SettingsStore = StoreApi<SettingsState>;

export const settingsKey = (uid: string) => `hv-settings-${uid}`;
export const LAST_SETTINGS_KEY = "hv-settings-last";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readSettings(key: string, store: Storage | null = storage()): PlayerSettings {
  try {
    const raw = store?.getItem(key);
    return parsePlayerSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(uid: string, settings: PlayerSettings, store: Storage | null = storage()): void {
  try {
    const json = JSON.stringify(settings);
    store?.setItem(settingsKey(uid), json);
    store?.setItem(LAST_SETTINGS_KEY, json);
  } catch {
    // Storage full or blocked: the settings still apply for this session.
  }
}

function systemReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function createSettingsStore(): SettingsStore {
  return createStore<SettingsState>()(() => ({ uid: null, settings: readSettings(LAST_SETTINGS_KEY), systemReducedMotion: systemReducedMotion() }));
}

export const settingsStore = createSettingsStore();

/** Reflect the settings in the document and the renderer. */
export function applySettings(state: SettingsState = settingsStore.getState()): void {
  const { settings } = state;
  const reduced = reducesMotion(settings, state.systemReducedMotion);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.hvTextSize = settings.textSize;
    root.style.setProperty("--hv-text-scale", String(TEXT_SIZES[settings.textSize]));
    root.dataset.hvAccents = settings.accents;
    if (reduced) root.dataset.hvReducedMotion = "";
    else delete root.dataset.hvReducedMotion;
  }
  const render = renderOptions(settings, state.systemReducedMotion);
  const diorama = dioramaStore.getState();
  if (diorama.effects !== render.effects) diorama.setEffects(render.effects);
  if (diorama.tiltShift !== render.tiltShift) diorama.setTiltShift(render.tiltShift);
}

/** Switch to a player's saved settings (sign-in), or back to the device default (null). */
export function loadSettingsFor(uid: string | null, store: SettingsStore = settingsStore): void {
  store.setState({ uid, settings: readSettings(uid ? settingsKey(uid) : LAST_SETTINGS_KEY) });
  if (store === settingsStore) applySettings(store.getState());
}

/** Change some settings; they are saved for the current player and applied. */
export function updateSettings(patch: Partial<PlayerSettings>, store: SettingsStore = settingsStore): void {
  const { uid, settings } = store.getState();
  const next = parsePlayerSettings({ ...settings, ...patch });
  store.setState({ settings: next });
  if (uid) writeSettings(uid, next);
  if (store === settingsStore) applySettings(store.getState());
}

/** Rebind one game action (input/keymap `rebindKey`), saving the result. */
export function rebindAction(action: GameAction, code: string, store: SettingsStore = settingsStore): RebindResult {
  const result = rebindKey(store.getState().settings.keymap, action, code);
  if (result.ok) updateSettings({ keymap: result.keymap }, store);
  return result;
}

/** Follow changes of the system's reduced-motion preference. Returns a stop function. */
export function watchSystemMotion(store: SettingsStore = settingsStore): () => void {
  try {
    if (typeof matchMedia !== "function") return () => {};
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      store.setState({ systemReducedMotion: query.matches });
      if (store === settingsStore) applySettings(store.getState());
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}

/** True when a keyboard event's key is the one bound to `action` (input/keymap). */
export function isAction(e: Pick<KeyboardEvent, "code">, action: GameAction): boolean {
  return matchesAction(settingsStore.getState().settings.keymap, action, e.code);
}

/** The key bound to an action, for hints and `aria-keyshortcuts`. */
export function boundKey(action: GameAction): string {
  return settingsStore.getState().settings.keymap[action];
}

/** Whether the camera eases (off with reduced motion); read every frame by the camera. */
export function cameraEasing(): boolean {
  const s = settingsStore.getState();
  return !reducesMotion(s.settings, s.systemReducedMotion);
}

export function useSettings<T>(selector: (s: SettingsState) => T, store: SettingsStore = settingsStore): T {
  return useStore(store, selector);
}
