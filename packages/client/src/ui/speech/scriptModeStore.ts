import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { isScriptMode, type ScriptMode } from "@hellovalley/shared";

/**
 * The script toggle choice per target language (GDD §6.1, build plan M19). It is kept in
 * localStorage so it applies at once on this device, and written through to
 * `users/{uid}/langs/{lang}.settings.scriptMode` by the sink that scriptModeSync installs after
 * sign-in (so it follows the player to other devices).
 */

export const SCRIPT_MODE_STORAGE_KEY = "hv.scriptMode";

export type ScriptModeSink = (lang: string, mode: ScriptMode) => void;

export interface ScriptModeState {
  modes: Readonly<Record<string, ScriptMode>>;
  /** The player's choice: saved locally and sent to the sink. */
  setMode: (lang: string, mode: ScriptMode) => void;
  /** A value read from Firestore: applied only when this device has no choice of its own. */
  hydrate: (lang: string, mode: ScriptMode) => void;
}

function readStorage(storage: Storage | undefined): Record<string, ScriptMode> {
  try {
    const raw = storage?.getItem(SCRIPT_MODE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, ScriptMode] => isScriptMode(e[1])));
  } catch {
    return {};
  }
}

function writeStorage(storage: Storage | undefined, modes: Record<string, ScriptMode>): void {
  try {
    storage?.setItem(SCRIPT_MODE_STORAGE_KEY, JSON.stringify(modes));
  } catch {
    // Private mode or a full quota: the choice still applies for this session.
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

let sink: ScriptModeSink | null = null;

/** Installs (or removes) the remote writer for the player's choices. */
export function setScriptModeSink(next: ScriptModeSink | null): void {
  sink = next;
}

export function createScriptModeStore(storage: Storage | undefined = defaultStorage()) {
  return createStore<ScriptModeState>()((set, get) => ({
    modes: readStorage(storage),
    setMode: (lang, mode) => {
      const modes = { ...get().modes, [lang]: mode };
      set({ modes });
      writeStorage(storage, modes);
      sink?.(lang, mode);
    },
    hydrate: (lang, mode) => {
      if (get().modes[lang] !== undefined) return;
      const modes = { ...get().modes, [lang]: mode };
      set({ modes });
      writeStorage(storage, modes);
    },
  }));
}

export const scriptModeStore = createScriptModeStore();

/** The stored choice for a language (undefined: none yet, the default applies). */
export function useStoredScriptMode(lang: string): ScriptMode | undefined {
  return useStore(scriptModeStore, (s) => s.modes[lang]);
}
