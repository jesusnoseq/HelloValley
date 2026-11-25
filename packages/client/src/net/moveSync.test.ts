import { describe, expect, it } from "vitest";
import { MOVE_SEND_INTERVAL_MS, MoveSync, type WalkerState } from "./moveSync";

const at = (x: number, motion: WalkerState["motion"] = "walk", space: WalkerState["space"] = "town"): WalkerState => ({ space, pos: [x, 5], heading: 0, motion });

describe("MoveSync", () => {
  it("sends the first report at once, then at most every interval while moving", () => {
    const sync = new MoveSync();
    expect(sync.next(at(0), 0)).toMatchObject({ seq: 1, epoch: 0, x: 0, z: 5, motion: "walk" });
    expect(sync.next(at(0.1), 10)).toBeNull();
    expect(sync.next(at(0.2), MOVE_SEND_INTERVAL_MS)).toMatchObject({ seq: 2, x: 0.2 });
    // Nothing changed: nothing to send.
    expect(sync.next(at(0.2), 1000)).toBeNull();
  });

  it("sends stops, space changes and forced reports at once", () => {
    const sync = new MoveSync();
    sync.next(at(0), 0);
    expect(sync.next(at(0.05, "idle"), 1)).toMatchObject({ seq: 2, motion: "idle" });
    expect(sync.next(at(0.3, "walk"), 2)).toBeNull();
    expect(sync.next(at(0.3, "walk"), 3, true)).toMatchObject({ seq: 3 });
    expect(sync.next(at(1, "idle", "bakery"), 4)).toMatchObject({ seq: 4, space: "bakery" });
  });

  it("adopts a correction's epoch once and ignores stale ones", () => {
    const sync = new MoveSync();
    sync.next(at(0), 0);
    const c = { epoch: 1, space: "town" as const, x: 3, z: 4, heading: 1, reason: "speed" as const };
    expect(sync.correct(c)).toEqual({ space: "town", pos: [3, 4], heading: 1 });
    expect(sync.correct(c)).toBeNull();
    expect(sync.epoch).toBe(1);
    // The next report is in the new epoch and goes out at once.
    expect(sync.next(at(3.1), 5)).toMatchObject({ epoch: 1, seq: 2 });
  });

  it("starts over for a new session", () => {
    const sync = new MoveSync();
    sync.next(at(0), 0);
    sync.correct({ epoch: 3, space: "town", x: 0, z: 0, heading: 0, reason: "blocked" });
    sync.reset();
    expect(sync.next(at(0), 100)).toMatchObject({ seq: 1, epoch: 0 });
  });
});
