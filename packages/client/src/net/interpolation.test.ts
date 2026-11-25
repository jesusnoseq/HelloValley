import { describe, expect, it } from "vitest";
import { INTERP_BUFFER_MS, NOMINAL_INTERVAL_MS, RemoteTrack, type RemoteSample, RESUME_GAP_MS } from "./interpolation";

const s = (x: number, motion: RemoteSample["motion"] = "walk", extra: Partial<RemoteSample> = {}): RemoteSample => ({ space: "town", x, z: 0, heading: 0, motion, ...extra });

describe("RemoteTrack", () => {
  it("interpolates between snapshots and clamps at the ends", () => {
    const t = new RemoteTrack();
    expect(t.sampleAt(0)).toBeNull();
    t.push(1000, s(0));
    t.push(1050, s(1));
    t.push(1100, s(2, "idle"));
    expect(t.sampleAt(900)).toMatchObject({ x: 0 });
    expect(t.sampleAt(1025)!.x).toBeCloseTo(0.5, 9);
    expect(t.sampleAt(1075)).toMatchObject({ motion: "walk" });
    expect(t.sampleAt(1075)!.x).toBeCloseTo(1.5, 9);
    expect(t.sampleAt(2000)).toMatchObject({ x: 2, motion: "idle" });
    expect(t.latest).toMatchObject({ x: 2 });
  });

  it("turns along the shortest arc", () => {
    const t = new RemoteTrack();
    t.push(0, s(0, "walk", { heading: Math.PI - 0.1 }));
    t.push(100, s(0, "walk", { heading: -Math.PI + 0.1 }));
    const h = t.sampleAt(50)!.heading;
    expect(Math.abs(Math.atan2(Math.sin(h), Math.cos(h)))).toBeCloseTo(Math.PI, 6);
  });

  it("cuts on teleports and space changes instead of gliding", () => {
    const t = new RemoteTrack();
    t.push(0, s(0));
    t.push(50, s(10));
    expect(t.sampleAt(25)).toMatchObject({ x: 0 });
    t.push(100, s(10, "idle", { space: "bakery" }));
    expect(t.sampleAt(75)).toMatchObject({ x: 10, space: "town" });
    expect(t.sampleAt(100)).toMatchObject({ space: "bakery" });
  });

  it("starts a move after a pause from rest, not by crawling through the pause", () => {
    const t = new RemoteTrack();
    t.push(0, s(0, "idle"));
    const resume = RESUME_GAP_MS + 1000;
    t.push(resume, s(0.2));
    // Halfway through the pause the avatar is still where it stopped.
    expect(t.sampleAt(resume / 2)!.x).toBe(0);
    expect(t.sampleAt(resume - NOMINAL_INTERVAL_MS / 2)!.x).toBeCloseTo(0.1, 9);
  });

  it("drops old snapshots", () => {
    const t = new RemoteTrack();
    for (let k = 0; k < 100; k++) t.push(k * 50, s(k * 0.1));
    expect(t.size).toBeLessThanOrEqual(INTERP_BUFFER_MS / 50 + 2);
    expect(t.sampleAt(99 * 50)!.x).toBeCloseTo(9.9, 9);
  });
});
