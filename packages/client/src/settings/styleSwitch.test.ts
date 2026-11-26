import { describe, expect, it, vi } from "vitest";
import type { StyleId } from "@hellovalley/shared";
import { createStyleSwitcher, type StyleSwitchDeps } from "./styleSwitch";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(start: StyleId = "european") {
  let style = start;
  const loads = new Map<StyleId, ReturnType<typeof deferred>>();
  const deps: StyleSwitchDeps & { apply: ReturnType<typeof vi.fn>; persist: ReturnType<typeof vi.fn> } = {
    current: () => style,
    preload: (s) => {
      const d = deferred();
      loads.set(s, d);
      return d.promise;
    },
    apply: vi.fn((s: StyleId) => {
      style = s;
    }),
    persist: vi.fn(async () => {}),
  };
  return { deps, loads, switcher: createStyleSwitcher(deps), style: () => style };
}

describe("style switch (Settings)", () => {
  it("keeps the old style on screen until the new kit has loaded, then swaps and saves", async () => {
    const { deps, loads, switcher, style } = setup();
    const done = switcher.select("japanese");
    expect(switcher.store.getState().pending).toBe("japanese");
    expect(deps.apply).not.toHaveBeenCalled();
    expect(style()).toBe("european");
    loads.get("japanese")!.resolve();
    expect(await done).toBe("applied");
    expect(deps.apply).toHaveBeenCalledExactlyOnceWith("japanese");
    expect(deps.persist).toHaveBeenCalledExactlyOnceWith("japanese");
    expect(switcher.store.getState()).toEqual({ pending: null, error: null });
  });

  it("does nothing for the style already on screen", async () => {
    const { deps, switcher } = setup("arabic");
    expect(await switcher.select("arabic")).toBe("unchanged");
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("lets a newer choice supersede one still loading", async () => {
    const { deps, loads, switcher, style } = setup();
    const first = switcher.select("japanese");
    const second = switcher.select("arabic");
    loads.get("arabic")!.resolve();
    expect(await second).toBe("applied");
    loads.get("japanese")!.resolve();
    expect(await first).toBe("superseded");
    expect(style()).toBe("arabic");
    expect(deps.apply).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending switch when the player goes back to the current style", async () => {
    const { deps, loads, switcher, style } = setup();
    const first = switcher.select("mediterranean");
    expect(await switcher.select("european")).toBe("unchanged");
    expect(switcher.store.getState().pending).toBeNull();
    loads.get("mediterranean")!.resolve();
    expect(await first).toBe("superseded");
    expect(style()).toBe("european");
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("keeps the current style when the kit fails to load", async () => {
    const { deps, loads, switcher, style } = setup();
    const done = switcher.select("japanese");
    loads.get("japanese")!.reject(new Error("offline"));
    expect(await done).toBe("failed");
    expect(style()).toBe("european");
    expect(deps.persist).not.toHaveBeenCalled();
    expect(switcher.store.getState()).toEqual({ pending: null, error: "load" });
  });

  it("keeps the new style on screen but reports a failed save", async () => {
    const { deps, loads, switcher, style } = setup();
    deps.persist.mockRejectedValueOnce(new Error("permission-denied"));
    const done = switcher.select("japanese");
    loads.get("japanese")!.resolve();
    expect(await done).toBe("applied");
    expect(style()).toBe("japanese");
    expect(switcher.store.getState().error).toBe("save");
  });
});
