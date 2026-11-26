import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
// Type-only: the forage rules (shared, with zod) stay in the lazy chunks.
import type { ForageAlbum, ForageResultMessage, TownForageView, Vec2 } from "@hellovalley/shared";

/**
 * Foraging on the client (build plan M28, GDD §5.3): the day's spawns in this shard (a mirror of
 * the room's synced `forage` map), the spawn the player stands next to (what F picks up), the
 * server's answer to the last pick-up and the forage album it keeps (`forage:album`). The client
 * never decides what a pick-up yields: it shows what the server said.
 */

export interface ClientSpawn extends TownForageView {
  spawnId: string;
  pos: Vec2;
}

export interface ForageState {
  /** Spawn id → spawn, as the room syncs it (only in the town space). */
  spawns: Readonly<Record<string, ClientSpawn>>;
  /** The spawn within reach of the local player (set by scene/Player.tsx on change), or null. */
  nearby: string | null;
  /** A `forage:pick` is on its way. */
  picking: string | null;
  /** The server's answer to the last pick-up, until the next one (or it fades). */
  last: ForageResultMessage | null;
  album: ForageAlbum;
  albumLoaded: boolean;
  /** The forage album panel is open. */
  albumOpen: boolean;
}

export type ForageStore = StoreApi<ForageState>;

export const initialForageState = (): ForageState => ({
  spawns: {},
  nearby: null,
  picking: null,
  last: null,
  album: { found: {}, returned: {} },
  albumLoaded: false,
  albumOpen: false,
});

export function createForageStore(): ForageStore {
  return createStore<ForageState>()(() => initialForageState());
}

export const forageStore = createForageStore();

export function useForage<T>(selector: (state: ForageState) => T, store: ForageStore = forageStore): T {
  return useStore(store, selector);
}
