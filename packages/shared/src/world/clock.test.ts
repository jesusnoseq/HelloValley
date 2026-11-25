import { describe, expect, it } from "vitest";
import {
  CLOCK_SYNC_MAX_RTT_MS,
  ClockSync,
  clockMinutesForPhase,
  DAY_FRACTION,
  formatClockMinutes,
  phaseForClockMinutes,
  SUNRISE_MINUTES,
  SUNSET_MINUTES,
  timeOfDayForMinutes,
  WORLD_DAY_MS,
  WORLD_EPOCH_MS,
  worldClockAt,
  worldDayAt,
  worldPhaseAt,
} from "./clock";

describe("world clock", () => {
  it("runs one in-game day every 40 real minutes", () => {
    expect(WORLD_DAY_MS).toBe(40 * 60 * 1000);
    expect(worldPhaseAt(WORLD_EPOCH_MS)).toBe(0);
    expect(worldPhaseAt(WORLD_EPOCH_MS + WORLD_DAY_MS / 4)).toBeCloseTo(0.25, 12);
    expect(worldPhaseAt(WORLD_EPOCH_MS + WORLD_DAY_MS * 3 + 1)).toBeCloseTo(0, 6);
    expect(worldDayAt(WORLD_EPOCH_MS + WORLD_DAY_MS * 3 + 1)).toBe(3);
    expect(worldDayAt(WORLD_EPOCH_MS - 1)).toBe(-1);
    expect(worldPhaseAt(WORLD_EPOCH_MS - WORLD_DAY_MS / 4)).toBeCloseTo(0.75, 12);
  });

  it("maps sunrise to 06:00 and sunset (30 real minutes later) to 21:00", () => {
    expect(clockMinutesForPhase(0)).toBe(SUNRISE_MINUTES);
    expect(clockMinutesForPhase(DAY_FRACTION)).toBeCloseTo(SUNSET_MINUTES, 9);
    expect(clockMinutesForPhase(DAY_FRACTION / 2)).toBeCloseTo((SUNRISE_MINUTES + SUNSET_MINUTES) / 2, 9);
    // Midnight falls inside the night quarter.
    const midnight = phaseForClockMinutes(0);
    expect(midnight).toBeGreaterThan(DAY_FRACTION);
    expect(clockMinutesForPhase(midnight)).toBeCloseTo(0, 6);
  });

  it("is monotonic over a day and inverts cleanly", () => {
    let last = -1;
    for (let k = 0; k < 400; k++) {
      const phase = k / 400;
      const m = clockMinutesForPhase(phase);
      const unwrapped = m < SUNRISE_MINUTES ? m + 1440 : m;
      expect(unwrapped).toBeGreaterThan(last);
      last = unwrapped;
      expect(phaseForClockMinutes(m)).toBeCloseTo(phase, 9);
    }
  });

  it("names the time-of-day bands", () => {
    expect(timeOfDayForMinutes(6 * 60)).toBe("morning");
    expect(timeOfDayForMinutes(11 * 60 + 59)).toBe("morning");
    expect(timeOfDayForMinutes(12 * 60)).toBe("afternoon");
    expect(timeOfDayForMinutes(17 * 60)).toBe("evening");
    expect(timeOfDayForMinutes(21 * 60)).toBe("night");
    expect(timeOfDayForMinutes(3 * 60)).toBe("night");
    expect(timeOfDayForMinutes(-60)).toBe("night");
  });

  it("formats clock times", () => {
    expect(formatClockMinutes(0)).toBe("00:00");
    expect(formatClockMinutes(6 * 60 + 5.9)).toBe("06:05");
    expect(formatClockMinutes(1440 + 75)).toBe("01:15");
  });

  it("worldClockAt bundles phase, day, minutes and band", () => {
    const now = WORLD_EPOCH_MS + WORLD_DAY_MS * 2 + WORLD_DAY_MS * (DAY_FRACTION / 2);
    expect(worldClockAt(now)).toMatchObject({ day: 2, timeOfDay: "afternoon" });
    expect(worldClockAt(now).minutes).toBeCloseTo(13.5 * 60, 6);
  });
});

describe("ClockSync", () => {
  it("estimates the server clock from the fastest round trip", () => {
    const sync = new ClockSync();
    expect(sync.synced).toBe(false);
    expect(sync.serverTime(1000)).toBe(1000);
    // The server is 5 s ahead. A slow sample (asymmetric delay) and a fast one.
    expect(sync.add({ sentMs: 0, serverMs: 5000 + 300, receivedMs: 400 })).toBe(true);
    expect(sync.add({ sentMs: 1000, serverMs: 6000 + 20, receivedMs: 1040 })).toBe(true);
    expect(sync.synced).toBe(true);
    expect(sync.rttMs).toBe(40);
    expect(sync.offsetMs).toBe(5000);
    expect(sync.serverTime(2000)).toBe(7000);
  });

  it("ignores implausible samples and forgets old ones", () => {
    const sync = new ClockSync();
    expect(sync.add({ sentMs: 10, serverMs: 0, receivedMs: 5 })).toBe(false);
    expect(sync.add({ sentMs: 0, serverMs: 0, receivedMs: CLOCK_SYNC_MAX_RTT_MS + 1 })).toBe(false);
    expect(sync.add({ sentMs: 0, serverMs: Number.NaN, receivedMs: 10 })).toBe(false);
    expect(sync.synced).toBe(false);
    sync.add({ sentMs: 0, serverMs: 100, receivedMs: 2 });
    for (let k = 1; k <= 10; k++) sync.add({ sentMs: k * 1000, serverMs: k * 1000 + 50 + 25, receivedMs: k * 1000 + 50 });
    // The 2 ms sample (offset 99) has been pushed out by the 50 ms ones (offset 50).
    expect(sync.offsetMs).toBe(50);
    sync.reset();
    expect(sync.synced).toBe(false);
  });
});
