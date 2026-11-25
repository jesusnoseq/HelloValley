import { WEATHERS, type Weather } from "../data/world";

/**
 * Cosmetic weather (GDD §4.3: sun, light rain, fog), as a world-state value: one weather per
 * fixed slot of real time, picked deterministically from the slot number and a seed, so every
 * client and the server agree without syncing more than the seed. Clients cross-fade between
 * weathers with `weatherWeights` / `easeWeatherWeights`.
 *
 * The TownRoom broadcasts the current weather from `weatherAt(Date.now(), WORLD_WEATHER_SEED)` in
 * its room state (architecture §7.1, build plan M16), so a client with a wrong clock still shows
 * the server's weather; offline (dev pages) the client runs the same schedule locally.
 */

/**
 * Seed of the weather schedule. My choice: one seed for every shard, so the whole valley shares
 * its weather and moving to a friend's shard does not change the sky.
 */
export const WORLD_WEATHER_SEED = 0;

/** One weather slot: a quarter of the 40-minute in-game day (architecture §3.1). */
export const WEATHER_SLOT_MS = 10 * 60 * 1000;

/** How often each weather comes up. Sun dominates: the town should feel bright and cosy. */
export const WEATHER_WEIGHTS: Readonly<Record<Weather, number>> = { sun: 0.6, rain: 0.25, fog: 0.15 };

/** Seconds a cross-fade between two weathers takes on the client. */
export const WEATHER_FADE_SECONDS = 20;

/** Fraction of each weather in the current look; the values sum to 1. */
export type WeatherWeights = Record<Weather, number>;

/** Deterministic hash of an integer slot and seed to [0, 1). */
function slotHash(slot: number, seed: number): number {
  let h = (Math.imul(Math.floor(slot) | 0, 0x9e3779b1) ^ Math.imul((seed | 0) + 0x632be5ab, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The weather of one slot. Never the same non-sunny weather twice in a row (rain clears up). */
export function weatherForSlot(slot: number, seed = 0): Weather {
  const pick = (s: number): Weather => {
    let r = slotHash(s, seed);
    for (const w of WEATHERS) {
      r -= WEATHER_WEIGHTS[w];
      if (r < 0) return w;
    }
    return "sun";
  };
  const w = pick(slot);
  return w !== "sun" && pick(slot - 1) === w ? "sun" : w;
}

export interface WeatherNow {
  weather: Weather;
  /** Weather of the previous slot (what the client fades from). */
  previous: Weather;
  slot: number;
  /** Real seconds since the slot began. */
  secondsIntoSlot: number;
}

/** The scheduled weather at a real time (ms since the Unix epoch). */
export function weatherAt(epochMs: number, seed = 0): WeatherNow {
  const slot = Math.floor(epochMs / WEATHER_SLOT_MS);
  return {
    weather: weatherForSlot(slot, seed),
    previous: weatherForSlot(slot - 1, seed),
    slot,
    secondsIntoSlot: (epochMs - slot * WEATHER_SLOT_MS) / 1000,
  };
}

/** All of one weather. */
export function pureWeather(w: Weather): WeatherWeights {
  return { sun: w === "sun" ? 1 : 0, rain: w === "rain" ? 1 : 0, fog: w === "fog" ? 1 : 0 };
}

/** The cross-fade `secondsIntoChange` after the weather turned from `from` to `to` (smoothstep). */
export function weatherWeights(from: Weather, to: Weather, secondsIntoChange: number, fade = WEATHER_FADE_SECONDS): WeatherWeights {
  const raw = fade > 0 ? Math.min(1, Math.max(0, secondsIntoChange / fade)) : 1;
  const f = raw * raw * (3 - 2 * raw);
  const out = pureWeather(to);
  if (from === to || f >= 1) return out;
  for (const w of WEATHERS) out[w] = (w === to ? f : 0) + (w === from ? 1 - f : 0);
  return out;
}

/**
 * Ease the current weights towards a target weather, frame-rate independent: a change takes about
 * `fade` seconds whatever the frame rate, and a change of target mid-fade blends from wherever the
 * look currently is. Returns new weights that sum to 1.
 */
export function easeWeatherWeights(current: Readonly<WeatherWeights>, target: Weather, dtSeconds: number, fade = WEATHER_FADE_SECONDS): WeatherWeights {
  const goal = pureWeather(target);
  // Exponential approach that is 99 % there after `fade` seconds.
  const k = fade > 0 ? 1 - Math.exp((-4.6 * Math.max(0, dtSeconds)) / fade) : 1;
  const out = { sun: 0, rain: 0, fog: 0 } as WeatherWeights;
  let sum = 0;
  for (const w of WEATHERS) {
    const v = current[w] + (goal[w] - current[w]) * k;
    out[w] = Number.isFinite(v) ? Math.max(0, v) : goal[w];
    sum += out[w];
  }
  if (!(sum > 0)) return goal;
  for (const w of WEATHERS) out[w] /= sum;
  // Snap once the fade is visually done so the look settles exactly.
  if (out[target] > 0.999) return goal;
  return out;
}
