/**
 * Mixing math (build plan M35): volume sliders, bus gains, ducking, crossfade curves and gain
 * smoothing. Pure numbers, so the client's Web Audio graph only schedules what these return.
 */

/** The three volume sliders in Settings, each 0–1. Ambience follows the SFX slider. */
export interface AudioVolumes {
  music: number;
  voice: number;
  sfx: number;
}

export const AUDIO_CHANNELS = ["music", "voice", "sfx"] as const satisfies readonly (keyof AudioVolumes)[];
export type AudioChannel = (typeof AUDIO_CHANNELS)[number];

/** Music a little under the voices: the NPC lines are the point of the game. */
export const DEFAULT_AUDIO_VOLUMES: Readonly<AudioVolumes> = { music: 0.6, voice: 1, sfx: 0.8 };

export function clampVolume(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

/** Saved volumes from any JSON value: unknown or broken fields fall back to the defaults. */
export function parseAudioVolumes(value: unknown): AudioVolumes {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    music: clampVolume(o.music, DEFAULT_AUDIO_VOLUMES.music),
    voice: clampVolume(o.voice, DEFAULT_AUDIO_VOLUMES.voice),
    sfx: clampVolume(o.sfx, DEFAULT_AUDIO_VOLUMES.sfx),
  };
}

/**
 * Slider position → linear gain. A square law, so the slider's middle sounds like about half
 * as loud (−12 dB) rather than barely quieter, and 0 is silence.
 */
export function sliderToGain(v: number): number {
  const c = clampVolume(v, 0);
  return c * c;
}

/** Music level while an NPC voice line plays (about −7 dB), so the words stay clear. */
export const VOICE_DUCK_GAIN = 0.45;
/** Ambience bus relative to the SFX slider: beds sit below the one-shots. */
export const AMBIENCE_BUS_GAIN = 0.8;

export interface BusGains {
  music: number;
  voice: number;
  sfx: number;
  ambience: number;
}

/** The gain of each mixer bus for the sliders and whether a voice line is playing. */
export function busGains(volumes: AudioVolumes, opts: { voiceActive?: boolean } = {}): BusGains {
  return {
    music: sliderToGain(volumes.music) * (opts.voiceActive ? VOICE_DUCK_GAIN : 1),
    voice: sliderToGain(volumes.voice),
    sfx: sliderToGain(volumes.sfx),
    ambience: sliderToGain(volumes.sfx) * AMBIENCE_BUS_GAIN,
  };
}

/** Seconds a music change (style, day ↔ night) takes to crossfade. */
export const MUSIC_CROSSFADE_SECONDS = 6;
/** Time constant of the ambient layer gains (seconds): walking to the river fades it in smoothly. */
export const AMBIENCE_TAU_SECONDS = 1.5;
/** Time constant for bus gain changes (sliders, ducking). */
export const BUS_TAU_SECONDS = 0.08;

const clamp01 = (t: number) => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);

/**
 * Equal-power crossfade at progress t (0 → 1): the outgoing and incoming gains, with
 * out² + in² = 1 throughout, so two unrelated loops keep a steady loudness through the change.
 */
export function equalPowerCrossfade(t: number): { out: number; in: number } {
  const x = clamp01(t);
  return { out: Math.cos((x * Math.PI) / 2), in: Math.sin((x * Math.PI) / 2) };
}

/**
 * A fade curve for `AudioParam.setValueCurveAtTime`: `n` points from the equal-power curve, scaled
 * to `peak` (the track's own level). "in" rises from 0 to peak, "out" falls from `from` to 0.
 */
export function crossfadeCurve(direction: "in" | "out", n: number, peak: number): Float32Array {
  const count = Math.max(2, Math.floor(n));
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const g = equalPowerCrossfade(i / (count - 1));
    curve[i] = (direction === "in" ? g.in : g.out) * peak;
  }
  return curve;
}

/** One step of exponential smoothing from `current` towards `target` (time constant `tau`). */
export function smoothGain(current: number, target: number, dt: number, tau: number): number {
  if (!(dt > 0) || !(tau > 0)) return dt > 0 ? target : current;
  const k = 1 - Math.exp(-dt / tau);
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 1e-4 ? target : next;
}

/** Hermite smoothstep of x between edge0 and edge1 (0 below, 1 above). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
