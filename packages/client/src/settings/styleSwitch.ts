import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: the switcher runs in the Settings chunk, but keep zod out of it anyway.
import type { StyleId } from "@hellovalley/shared";

/**
 * Switching the town style from Settings (GDD §7.3, build plan M34): the new style's kit is
 * loaded first (manifest, atlas and every GLB decoded, the old town stays on screen), then the
 * style is applied in one step, so the swap itself is instant, and finally it is saved to the
 * player's profile (`users/{uid}.style`, client-writable per firestore.rules). A newer choice
 * supersedes one still loading; a failed load keeps the current style; a failed save keeps the
 * new style on screen and reports the error (it is applied again on the next choice).
 */

export interface StyleSwitchDeps {
  /** The style on screen now. */
  current: () => StyleId;
  /** Load and decode everything the style needs (scene/stylePreload.ts). */
  preload: (style: StyleId) => Promise<void>;
  /** Show the style (dioramaStore.setStyle). */
  apply: (style: StyleId) => void;
  /** Save it to the player's profile. */
  persist: (style: StyleId) => Promise<void>;
}

export interface StyleSwitchState {
  /** The style being loaded, or null. */
  pending: StyleId | null;
  error: "load" | "save" | null;
}

export type StyleSwitchResult = "applied" | "unchanged" | "superseded" | "failed";

export interface StyleSwitcher {
  store: StoreApi<StyleSwitchState>;
  select: (style: StyleId) => Promise<StyleSwitchResult>;
}

export function createStyleSwitcher(deps: StyleSwitchDeps): StyleSwitcher {
  const store = createStore<StyleSwitchState>()(() => ({ pending: null, error: null }));
  let ticket = 0;

  async function select(style: StyleId): Promise<StyleSwitchResult> {
    const mine = ++ticket;
    if (style === deps.current()) {
      // Also cancels a switch still loading: the player went back to what is on screen.
      store.setState({ pending: null, error: null });
      return "unchanged";
    }
    store.setState({ pending: style, error: null });
    try {
      await deps.preload(style);
    } catch (error) {
      console.warn("style switch: could not load", style, error);
      if (mine === ticket) store.setState({ pending: null, error: "load" });
      return "failed";
    }
    if (mine !== ticket) return "superseded";
    deps.apply(style);
    store.setState({ pending: null });
    try {
      await deps.persist(style);
    } catch (error) {
      console.warn("style switch: could not save", style, error);
      if (mine === ticket) store.setState({ error: "save" });
    }
    return "applied";
  }

  return { store, select };
}
