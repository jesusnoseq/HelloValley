import type { TimeOfDay } from "../data/world";

/**
 * The shared world clock (GDD §4.3, architecture §3.1): 1 in-game day = 40 real minutes, a
 * 30-minute day and a 10-minute night. The clock comes from wall time, so it survives server
 * restarts: `phase = ((now − WORLD_EPOCH_MS) mod 40 min) / 40 min`. Phase 0 is sunrise and
 * `DAY_FRACTION` is sunset (the client's day/night gradient uses the same phase).
 *
 * In-game clock mapping (my choice, build plan M16): sunrise is 06:00 and sunset 21:00, so the
 * 15 daylight hours take 30 real minutes (2 min per hour) and the 9 night hours take 10 (66.7 s
 * per hour). Every NPC schedule point (05:00–23:00) lands at a sensible light level.
 *
 * Pure: the server stamps the room state with its time; clients estimate the server's clock with
 * `ClockSync` and compute the phase locally every frame.
 */

export const WORLD_DAY_MS = 40 * 60 * 1000;
/** Real start of in-game day 0 (a sunrise). Any fixed instant works; it only shifts the phase. */
export const WORLD_EPOCH_MS = Date.UTC(2026, 0, 1);
/** Fraction of the cycle that is daylight (30 of 40 minutes). */
export const DAY_FRACTION = 30 / 40;
export const SUNRISE_MINUTES = 6 * 60;
export const SUNSET_MINUTES = 21 * 60;
const MINUTES_PER_DAY = 24 * 60;
const DAYLIGHT_MINUTES = SUNSET_MINUTES - SUNRISE_MINUTES;
const NIGHT_MINUTES = MINUTES_PER_DAY - DAYLIGHT_MINUTES;

const wrap01 = (t: number) => {
  const w = t - Math.floor(t);
  return Number.isFinite(w) ? w : 0;
};

/** Cycle phase 0–1 at a real time (ms since the Unix epoch). */
export function worldPhaseAt(epochMs: number): number {
  return wrap01((epochMs - WORLD_EPOCH_MS) / WORLD_DAY_MS);
}

/** Index of the in-game day at a real time (day 0 began at WORLD_EPOCH_MS; it seeds daily spawns later). */
export function worldDayAt(epochMs: number): number {
  return Math.floor((epochMs - WORLD_EPOCH_MS) / WORLD_DAY_MS);
}

/** In-game minutes since midnight (0 ≤ m < 1440) for a cycle phase. */
export function clockMinutesForPhase(phase: number): number {
  const p = wrap01(phase);
  const minutes =
    p < DAY_FRACTION
      ? SUNRISE_MINUTES + (p / DAY_FRACTION) * DAYLIGHT_MINUTES
      : SUNSET_MINUTES + ((p - DAY_FRACTION) / (1 - DAY_FRACTION)) * NIGHT_MINUTES;
  return minutes % MINUTES_PER_DAY;
}

/** The cycle phase at which the in-game clock shows `minutes` (inverse of clockMinutesForPhase). */
export function phaseForClockMinutes(minutes: number): number {
  const m = (((minutes - SUNRISE_MINUTES) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return m < DAYLIGHT_MINUTES ? (m / DAYLIGHT_MINUTES) * DAY_FRACTION : DAY_FRACTION + ((m - DAYLIGHT_MINUTES) / NIGHT_MINUTES) * (1 - DAY_FRACTION);
}

/**
 * The time-of-day band for fish tables, openers and barks: morning 06:00–12:00, afternoon
 * 12:00–17:00, evening 17:00–21:00 (sunset), night 21:00–06:00.
 */
export function timeOfDayForMinutes(minutes: number): TimeOfDay {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (m >= SUNRISE_MINUTES && m < 12 * 60) return "morning";
  if (m >= 12 * 60 && m < 17 * 60) return "afternoon";
  if (m >= 17 * 60 && m < SUNSET_MINUTES) return "evening";
  return "night";
}

/** `HH:MM` for in-game minutes since midnight. */
export function formatClockMinutes(minutes: number): string {
  const m = Math.floor(((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface WorldClockNow {
  phase: number;
  day: number;
  minutes: number;
  timeOfDay: TimeOfDay;
}

/** Everything about the world clock at a real time. */
export function worldClockAt(epochMs: number): WorldClockNow {
  const phase = worldPhaseAt(epochMs);
  const minutes = clockMinutesForPhase(phase);
  return { phase, day: worldDayAt(epochMs), minutes, timeOfDay: timeOfDayForMinutes(minutes) };
}

// ---------------------------------------------------------------------------------------------
// Clock sync

/** One round trip: the client's send time, the server's time when it answered, the client's receive time. */
export interface ClockSample {
  sentMs: number;
  serverMs: number;
  receivedMs: number;
}

/** How many recent samples ClockSync keeps; the one with the shortest round trip wins. */
export const CLOCK_SYNC_SAMPLES = 8;
/** Round trips longer than this are ignored (a stalled tab, a stuck socket). */
export const CLOCK_SYNC_MAX_RTT_MS = 5000;

/**
 * NTP-style estimate of the server's wall clock on a client whose own clock may be wrong: each
 * sample says the server read `serverMs` halfway through the round trip. The estimate uses the
 * sample with the shortest round trip among the last few (the least queueing delay).
 */
export class ClockSync {
  private samples: { offset: number; rtt: number }[] = [];

  /** Adds a sample; returns false (and ignores it) when it is implausible. */
  add({ sentMs, serverMs, receivedMs }: ClockSample): boolean {
    const rtt = receivedMs - sentMs;
    if (![sentMs, serverMs, receivedMs].every(Number.isFinite) || rtt < 0 || rtt > CLOCK_SYNC_MAX_RTT_MS) return false;
    this.samples.push({ offset: serverMs - (sentMs + rtt / 2), rtt });
    if (this.samples.length > CLOCK_SYNC_SAMPLES) this.samples.shift();
    return true;
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** Server time minus client time in ms (0 before the first sample). */
  get offsetMs(): number {
    let best: { offset: number; rtt: number } | undefined;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best?.offset ?? 0;
  }

  /** Shortest recent round trip, or null. */
  get rttMs(): number | null {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) : null;
  }

  /** The estimated server time for a client time. */
  serverTime(clientMs: number): number {
    return clientMs + this.offsetMs;
  }

  reset(): void {
    this.samples = [];
  }
}
