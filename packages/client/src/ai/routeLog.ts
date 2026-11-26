import type { RouteEvent } from "./hybrid";

/**
 * The demo's AI route log (build plan M38, docs/demo-script.md): with `?ailog` in the URL (kept
 * for the session) or `localStorage["hv-ai-log"] = "1"`, every AI call prints where it ran to the
 * DevTools console, e.g. `[ai] translateShort → on-device (84 ms)` or `[ai] npcTurn → cloud
 * (template npc-turn-v1-0-0)`. Off by default: nothing is logged for players.
 */
export const ROUTE_LOG_KEY = "hv-ai-log";

type Store = Pick<Storage, "getItem" | "setItem">;

export function routeLogEnabled(search: string, session: Store | null, local: Store | null): boolean {
  try {
    if (new URLSearchParams(search).has("ailog")) {
      session?.setItem(ROUTE_LOG_KEY, "1");
      return true;
    }
    return session?.getItem(ROUTE_LOG_KEY) === "1" || local?.getItem(ROUTE_LOG_KEY) === "1";
  } catch {
    return false;
  }
}

export function formatRoute(event: RouteEvent | { task: string; source: string; detail: string }): string {
  return "ms" in event ? `[ai] ${event.task} → ${event.source} (${event.ms} ms)` : `[ai] ${event.task} → ${event.source} (${event.detail})`;
}

/** The console logger when the log is on, else null. */
export function createRouteLog(): ((event: RouteEvent | { task: string; source: string; detail: string }) => void) | null {
  const win = typeof window === "undefined" ? null : window;
  const safe = (get: () => Storage) => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  if (!win || !routeLogEnabled(win.location.search, safe(() => win.sessionStorage), safe(() => win.localStorage))) return null;
  return (event) => console.info(formatRoute(event));
}
