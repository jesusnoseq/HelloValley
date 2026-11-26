/**
 * Procedural placeholder audio (build plan M35, GDD §11): synthesises every clip in the shared
 * audio catalog (music loops per style and day/night, ambient loops, footsteps by surface, UI and
 * interaction effects) and encodes them to small mono Ogg/Opus files in
 * `packages/client/public/assets/audio/`. Nothing is downloaded: every sound is built here from
 * oscillators, filtered noise and Karplus–Strong plucks, with a fixed seed per clip, so a rerun
 * gives the same sounds. The clips are listed in docs/assets-credits.md.
 *
 *   npm run assets:audio                 generate every clip (needs ffmpeg with libopus on PATH)
 *   npm run assets:audio -- --only music-european-day   one clip (file name without .ogg)
 *
 * Loops are rendered circularly (note tails, filters and the reverb wrap past the end back to the
 * start), so they repeat without a click at `loopSeconds`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AMBIENT_LAYERS,
  type AmbientLayer,
  AUDIO_CLIPS,
  type AudioClipDef,
  FOOTSTEP_VARIANTS,
  footstepClipId,
  MUSIC_VARIANTS,
  type MusicVariant,
  musicTrackId,
  type SfxId,
  SFX_IDS,
  type Surface,
  SURFACES,
} from "../../packages/shared/src/audio/catalog";
import { STYLE_IDS, type StyleId } from "../../packages/shared/src/data/styles";

export const SAMPLE_RATE = 24000;
const SR = SAMPLE_RATE;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Buffers, randomness, filters

export class Buf {
  readonly data: Float32Array;
  constructor(
    seconds: number,
    readonly loop: boolean,
  ) {
    this.data = new Float32Array(Math.round(seconds * SR));
  }
  get length(): number {
    return this.data.length;
  }
  add(i: number, v: number): void {
    const n = this.data.length;
    if (this.loop) this.data[((i % n) + n) % n]! += v;
    else if (i >= 0 && i < n) this.data[i]! += v;
  }
}

/** mulberry32: a small deterministic PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(name: string): number {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

type FilterKind = "lowpass" | "highpass" | "bandpass";

/** RBJ biquad. */
class Biquad {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(kind: FilterKind, freq: number, q = 0.707) {
    this.set(kind, freq, q);
  }
  set(kind: FilterKind, freq: number, q = 0.707): void {
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number, b1: number, b2: number;
    if (kind === "lowpass") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (kind === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [b0, b1, b2] = [alpha, 0, -alpha];
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * Run a stateful effect over a buffer. For loops it runs over two copies and keeps the second, so
 * the effect's state (filter memory, reverb tail) wraps from the end into the start.
 */
function processBuf(buf: Buf, fx: (x: number) => number): void {
  const d = buf.data;
  if (buf.loop) for (let i = 0; i < d.length; i++) fx(d[i]!);
  for (let i = 0; i < d.length; i++) d[i] = fx(d[i]!);
}

function filterBuf(buf: Buf, kind: FilterKind, freq: number, q?: number): void {
  const f = new Biquad(kind, freq, q);
  processBuf(buf, (x) => f.step(x));
}

/** A small Schroeder reverb (4 combs, 2 allpasses), mixed in at `wet`. */
function reverb(buf: Buf, wet: number, size = 1): void {
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((s) => ({ line: new Float32Array(Math.round(s * size * SR)), i: 0 }));
  const alls = [0.005, 0.0017].map((s) => ({ line: new Float32Array(Math.round(s * SR)), i: 0 }));
  const fb = 0.78;
  processBuf(buf, (x) => {
    let s = 0;
    for (const c of combs) {
      const y = c.line[c.i]!;
      c.line[c.i] = x + y * fb;
      c.i = (c.i + 1) % c.line.length;
      s += y;
    }
    s *= 0.25;
    for (const a of alls) {
      const y = a.line[a.i]!;
      const v = s + y * 0.5;
      a.line[a.i] = v;
      a.i = (a.i + 1) % a.line.length;
      s = y - v * 0.5;
    }
    return x * (1 - wet * 0.5) + s * wet;
  });
}

function normalize(buf: Buf, peak = 0.7): void {
  let m = 0;
  for (const v of buf.data) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf.data[i]! *= peak / m;
}

/** Match loudness (RMS) across the music loops, never letting a peak pass `maxPeak`. */
function normalizeLoudness(buf: Buf, rms: number, maxPeak = 0.95): void {
  let m = 0;
  let e = 0;
  for (const v of buf.data) {
    m = Math.max(m, Math.abs(v));
    e += v * v;
  }
  const cur = Math.sqrt(e / Math.max(1, buf.length));
  if (m > 0 && cur > 0) {
    const g = Math.min(rms / cur, maxPeak / m);
    for (let i = 0; i < buf.length; i++) buf.data[i]! *= g;
  }
}

/** Short fades at the ends of a one-shot so it never clicks. */
function edgeFades(buf: Buf, inS = 0.002, outS = 0.02): void {
  const a = Math.round(inS * SR);
  const b = Math.round(outS * SR);
  for (let i = 0; i < a && i < buf.length; i++) buf.data[i]! *= i / a;
  for (let i = 0; i < b && i < buf.length; i++) buf.data[buf.length - 1 - i]! *= i / b;
}

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ---------------------------------------------------------------------------------------------
// Instruments

interface Env {
  a: number;
  d?: number;
  s?: number;
  r: number;
}

function envAt(t: number, dur: number, e: Env): number {
  const s = e.s ?? 1;
  const d = e.d ?? 0;
  let v: number;
  if (t < e.a) v = t / e.a;
  else if (t < e.a + d) v = 1 - ((t - e.a) / d) * (1 - s);
  else v = s;
  if (t > dur - e.r) v *= Math.max(0, (dur - t) / e.r);
  return v;
}

interface ToneOpts {
  partials: readonly (readonly [number, number])[];
  env: Env;
  amp: number;
  vibrato?: { rate: number; depth: number; delay?: number };
  detuneCents?: number;
  tremolo?: { rate: number; depth: number };
}

/** Additive tone: a sum of partials (ratio, amplitude) under an envelope. */
function tone(out: Buf, t0: number, dur: number, freq: number, o: ToneOpts): void {
  const start = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  const voices = o.detuneCents ? [-o.detuneCents, o.detuneCents] : [0];
  const phases = voices.map(() => o.partials.map(() => 0));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vib = o.vibrato ? 2 ** ((o.vibrato.depth * Math.sin(TAU * o.vibrato.rate * t) * Math.min(1, t / (o.vibrato.delay ?? 0.001))) / 1200) : 1;
    const trem = o.tremolo ? 1 - o.tremolo.depth * (0.5 + 0.5 * Math.sin(TAU * o.tremolo.rate * t)) : 1;
    let s = 0;
    voices.forEach((cents, vi) => {
      const f = freq * vib * 2 ** (cents / 1200);
      o.partials.forEach(([ratio, amp], pi) => {
        const ph = phases[vi]!;
        ph[pi]! += (TAU * f * ratio) / SR;
        if (f * ratio < SR * 0.45) s += amp * Math.sin(ph[pi]!);
      });
    });
    out.add(start + i, (s / voices.length) * o.amp * trem * envAt(t, dur, o.env));
  }
}

/** Karplus–Strong plucked string, computed at 4× the sample rate for accurate tuning. */
function pluck(out: Buf, t0: number, freq: number, o: { amp: number; decay: number; bright: number; dur?: number; seed: number }): void {
  const OS = 4;
  const sr = SR * OS;
  const period = sr / freq - 0.5;
  const len = Math.max(2, Math.floor(period));
  const frac = period - len;
  const line = new Float32Array(len + 2);
  const r = rng(o.seed);
  let lp = 0;
  for (let i = 0; i < line.length; i++) {
    lp += (r() * 2 - 1 - lp) * o.bright;
    line[i] = lp;
  }
  const dur = o.dur ?? Math.min(o.decay * 1.2, 6);
  const rho = 10 ** (-3 / (o.decay * freq));
  const start = Math.round(t0 * SR);
  const n = Math.round(dur * SR);
  let idx = 0;
  let acc = 0;
  let prev = 0;
  for (let i = 0; i < n * OS; i++) {
    const a = line[idx]!;
    const b = line[(idx + 1) % line.length]!;
    // Linear fractional delay plus the averaging loss filter.
    const y = a + (b - a) * frac;
    const next = rho * 0.5 * (y + prev);
    prev = y;
    line[idx] = next;
    idx = (idx + 1) % len;
    acc += y;
    if ((i + 1) % OS === 0) {
      const j = (i + 1) / OS - 1;
      const tail = j > n - 0.03 * SR ? (n - j) / (0.03 * SR) : 1;
      out.add(start + j, (acc / OS) * o.amp * tail);
      acc = 0;
    }
  }
}

function noiseBurst(out: Buf, t0: number, dur: number, o: { amp: number; env: Env; filter?: [FilterKind, number, number?][]; seed: number; sweep?: [number, number] }): void {
  const r = rng(o.seed);
  const tmp = new Float32Array(Math.round(dur * SR));
  const filters = (o.filter ?? []).map(([k, f, q]) => ({ bq: new Biquad(k, f, q), k, f, q }));
  for (let i = 0; i < tmp.length; i++) {
    const t = i / SR;
    if (o.sweep && filters[0] && i % 32 === 0) filters[0].bq.set(filters[0].k, o.sweep[0] * (o.sweep[1] / o.sweep[0]) ** (t / dur), filters[0].q);
    let x = r() * 2 - 1;
    for (const f of filters) x = f.bq.step(x);
    tmp[i] = x * envAt(t, dur, o.env);
  }
  const start = Math.round(t0 * SR);
  for (let i = 0; i < tmp.length; i++) out.add(start + i, tmp[i]! * o.amp);
}

/** A pitched thump or knock: a sine whose pitch drops, with an exponential decay. */
function thump(out: Buf, t0: number, o: { from: number; to: number; decay: number; amp: number; dur?: number }): void {
  const dur = o.dur ?? o.decay * 5;
  const start = Math.round(t0 * SR);
  let ph = 0;
  for (let i = 0; i < dur * SR; i++) {
    const t = i / SR;
    const f = o.to + (o.from - o.to) * Math.exp(-t / (o.decay * 0.5));
    ph += (TAU * f) / SR;
    out.add(start + i, Math.sin(ph) * Math.exp(-t / o.decay) * o.amp * Math.min(1, t / 0.001));
  }
}

/** A struck bell or metal: inharmonic partials with their own decays. */
function bell(out: Buf, t0: number, freq: number, o: { amp: number; decay: number; partials?: readonly [number, number][] }): void {
  const partials = o.partials ?? [
    [1, 1],
    [2.76, 0.5],
    [5.4, 0.25],
    [8.93, 0.12],
  ];
  const start = Math.round(t0 * SR);
  const n = Math.round(o.decay * 4 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const [ratio, amp] of partials) {
      if (freq * ratio >= SR * 0.45) continue;
      s += amp * Math.sin(TAU * freq * ratio * t) * Math.exp(-t / (o.decay / Math.sqrt(ratio)));
    }
    out.add(start + i, s * o.amp * Math.min(1, t / 0.002));
  }
}

const accordion = (detune: number): ToneOpts => ({
  partials: [
    [1, 1],
    [2, 0.6],
    [3, 0.45],
    [4, 0.3],
    [5, 0.22],
    [6, 0.12],
    [7, 0.08],
  ],
  env: { a: 0.05, d: 0.1, s: 0.85, r: 0.09 },
  amp: 0.18,
  detuneCents: detune,
  tremolo: { rate: 5.5, depth: 0.08 },
});

const shakuhachi: ToneOpts = {
  partials: [
    [1, 1],
    [2, 0.18],
    [3, 0.06],
  ],
  env: { a: 0.18, d: 0.2, s: 0.8, r: 0.25 },
  amp: 0.32,
  vibrato: { rate: 5, depth: 22, delay: 0.5 },
};

/** Breath for a flute note: band-passed noise around its pitch. */
function breath(out: Buf, t0: number, dur: number, freq: number, seed: number): void {
  noiseBurst(out, t0, dur, { amp: 0.35, env: { a: 0.12, r: 0.2 }, filter: [["bandpass", freq * 1.5, 1.5]], seed });
}

// ---------------------------------------------------------------------------------------------
// Music

interface Note {
  t: number;
  dur: number;
  midi: number;
}

/** MIDI notes of a scale (semitones above root) between lo and hi. */
function scaleNotes(root: number, scale: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (scale.includes((((m - root) % 12) + 12) % 12)) out.push(m);
  return out;
}

/**
 * A melody over a progression: chord tones on the strong beats, stepwise motion between, rests
 * at `restChance`, ending on the root.
 */
function melody(r: () => number, o: { bars: number; beatsPerBar: number; beat: number; rhythm: readonly (readonly [number, number])[]; chords: readonly (readonly number[])[]; notes: readonly number[]; root: number; restChance: number }): Note[] {
  const out: Note[] = [];
  let idx = Math.floor(o.notes.length / 2);
  for (let bar = 0; bar < o.bars; bar++) {
    const chord = o.chords[bar % o.chords.length]!;
    o.rhythm.forEach(([at, len], k) => {
      const last = bar === o.bars - 1 && k === o.rhythm.length - 1;
      if (!last && k > 0 && r() < o.restChance) return;
      const strong = Number.isInteger(at) && (at === 0 || at === o.beatsPerBar / 2 || o.beatsPerBar === 3);
      if (strong || last) {
        // Nearest chord tone (any octave) to where the line is.
        let best = idx;
        let bestD = Infinity;
        o.notes.forEach((m, i) => {
          const pc = (((m - o.root) % 12) + 12) % 12;
          const isChord = last ? pc === 0 : chord.some((c) => ((c % 12) + 12) % 12 === pc);
          const d = Math.abs(i - idx) + r() * 0.5;
          if (isChord && d < bestD) [best, bestD] = [i, d];
        });
        idx = best;
      } else {
        const step = [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)]!;
        idx = Math.min(o.notes.length - 1, Math.max(0, idx + step));
      }
      out.push({ t: (bar * o.beatsPerBar + at) * o.beat, dur: len * o.beat, midi: o.notes[idx]! });
    });
  }
  return out;
}

interface MusicPlan {
  root: number;
  scale: readonly number[];
  beatsPerBar: number;
  bars: number;
  /** Chords as semitones above the root, one per bar (repeats). */
  chords: readonly (readonly number[])[];
  rhythm: readonly (readonly [number, number])[];
  restChance: number;
  lead: [number, number];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const HIJAZ = [0, 1, 4, 5, 7, 8, 10];
const YO = [0, 2, 5, 7, 9];
const IN_SCALE = [0, 1, 5, 7, 8];

const I = [0, 4, 7];
const vi = [9, 12, 16];
const IV = [5, 9, 12];
const V = [7, 11, 14];
const i_ = [0, 3, 7];
const iv = [5, 8, 12];
const bVII = [10, 14, 17];
const bVI = [8, 12, 15];
const V7 = [7, 11, 14, 17];

const PLANS: Record<StyleId, Record<MusicVariant, MusicPlan>> = {
  // A musette waltz by day, a slow minor ballad at night.
  european: {
    day: { root: 60, scale: MAJOR, beatsPerBar: 3, bars: 16, chords: [I, I, vi, vi, IV, IV, V, V], rhythm: [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1]], restChance: 0.15, lead: [67, 86] },
    night: { root: 57, scale: MINOR, beatsPerBar: 4, bars: 8, chords: [i_, iv, bVII, [3, 7, 10], bVI, iv, V7, i_], rhythm: [[0, 1.5], [1.5, 0.5], [2, 2]], restChance: 0.35, lead: [64, 81] },
  },
  // A bright mixolydian tune with tremolo mandolin by day, the Andalusian cadence at night.
  mediterranean: {
    day: { root: 62, scale: MIXOLYDIAN, beatsPerBar: 4, bars: 8, chords: [I, bVII, IV, I, I, bVII, V, I], rhythm: [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]], restChance: 0.15, lead: [69, 88] },
    night: { root: 62, scale: MINOR, beatsPerBar: 4, bars: 8, chords: [i_, bVII, bVI, V, i_, bVII, bVI, V], rhythm: [[0, 2], [2, 1], [3, 1]], restChance: 0.35, lead: [62, 79] },
  },
  // Maqam Hijaz on D: oud over a drone and a frame drum by day, qanun arpeggios at night.
  arabic: {
    day: { root: 62, scale: HIJAZ, beatsPerBar: 4, bars: 8, chords: [I, I, [5, 8, 12], I, [10, 13, 17], [5, 8, 12], I, I], rhythm: [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]], restChance: 0.2, lead: [62, 81] },
    night: { root: 62, scale: HIJAZ, beatsPerBar: 4, bars: 8, chords: [I, [5, 8, 12], I, [10, 13, 17], I, [5, 8, 12], [1, 5, 8], I], rhythm: [[0, 2], [2, 1.5], [3.5, 0.5]], restChance: 0.4, lead: [62, 79] },
  },
  // Koto in the yo scale by day; the in scale, shakuhachi and sparse koto at night.
  japanese: {
    day: { root: 62, scale: YO, beatsPerBar: 4, bars: 8, chords: [[0, 7, 14], [5, 9, 12], [0, 7, 14], [7, 14, 19]], rhythm: [[0, 1], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]], restChance: 0.2, lead: [69, 88] },
    night: { root: 62, scale: IN_SCALE, beatsPerBar: 4, bars: 8, chords: [[0, 7, 12], [5, 8, 12], [0, 7, 12], [1, 5, 8]], rhythm: [[0, 2.5], [2.5, 1.5]], restChance: 0.3, lead: [62, 81] },
  },
};

export function renderMusic(style: StyleId, variant: MusicVariant, seconds: number): Buf {
  const plan = PLANS[style][variant];
  const r = rng(seedOf(`${style}.${variant}`));
  const out = new Buf(seconds, true);
  const beat = seconds / (plan.bars * plan.beatsPerBar);
  const bar = beat * plan.beatsPerBar;
  const night = variant === "night";
  const notes = scaleNotes(plan.root, plan.scale, plan.lead[0], plan.lead[1]);
  const line = melody(r, { bars: plan.bars, beatsPerBar: plan.beatsPerBar, beat, rhythm: plan.rhythm, chords: plan.chords, notes, root: plan.root, restChance: plan.restChance });
  const chordAt = (b: number) => plan.chords[b % plan.chords.length]!.map((c) => plan.root - 12 + c);
  let seed = seedOf(`${style}${variant}notes`);
  const pl = (t: number, m: number, amp: number, decay: number, bright: number) => pluck(out, t, midiHz(m), { amp, decay, bright, seed: seed++ });

  // Bass on the chord roots, every style.
  for (let b = 0; b < plan.bars; b++) {
    const root = chordAt(b)[0]! - 12;
    pl(b * bar, root, 0.5, night ? 2.5 : 1.6, 0.25);
    if (!night && plan.beatsPerBar === 4) pl(b * bar + 2 * beat, root + 7, 0.35, 1.2, 0.25);
  }

  if (style === "european") {
    for (let b = 0; b < plan.bars; b++) {
      const ch = chordAt(b);
      if (night) {
        // Guitar arpeggios under a soft accordion pad.
        [0, 1, 2, 1, 0, 1, 2, 1].forEach((k, j) => pl(b * bar + j * (bar / 8), ch[k]! + 12, 0.22, 1.8, 0.45));
        for (const m of ch) tone(out, b * bar, bar, midiHz(m), { ...accordion(4), amp: 0.06 });
      } else {
        // Oom-pah-pah: guitar chord stabs on beats 2 and 3.
        for (const k of [1, 2]) ch.forEach((m, j) => pl(b * bar + k * beat + j * 0.012, m + 12, 0.18, 0.6, 0.5));
      }
    }
    for (const n of line) tone(out, n.t, n.dur * 0.95, midiHz(n.midi), { ...accordion(night ? 5 : 9), amp: night ? 0.16 : 0.2 });
  } else if (style === "mediterranean") {
    for (let b = 0; b < plan.bars; b++) {
      const ch = chordAt(b);
      // Strummed guitar: down on 1 and 3, up on the off-beats by day.
      const strums = night ? [0, 2, 3] : [0, 1.5, 2, 3, 3.5];
      for (const s of strums) ch.forEach((m, j) => pl(b * bar + s * beat + j * 0.015, m + 12, night ? 0.2 : 0.16, night ? 1.5 : 0.7, 0.55));
    }
    for (const n of line) {
      if (night) {
        pl(n.t, n.midi, 0.42, 2.2, 0.6);
      } else {
        // Mandolin tremolo: fast repeated plucks across the note.
        const reps = Math.max(1, Math.round(n.dur / (beat / 4)));
        for (let k = 0; k < reps; k++) pl(n.t + k * (beat / 4), n.midi, k === 0 ? 0.4 : 0.26, 0.35, 0.85);
      }
    }
  } else if (style === "arabic") {
    // Drone on the root.
    tone(out, 0, seconds, midiHz(plan.root - 24), { partials: [[1, 1], [2, 0.5], [3, 0.25]], env: { a: 0.01, r: 0.01 }, amp: 0.05 });
    if (!night) {
      // Maqsum on a frame drum: dum tek-tek dum tek.
      for (let b = 0; b < plan.bars; b++) {
        for (const [at, dum] of [[0, true], [0.75, false], [1.5, false], [2, true], [3, false]] as const) {
          const t = b * bar + at * beat;
          if (dum) thump(out, t, { from: 150, to: 85, decay: 0.12, amp: 0.45 });
          else noiseBurst(out, t, 0.06, { amp: 0.25, env: { a: 0.001, d: 0.02, s: 0.2, r: 0.03 }, filter: [["bandpass", 3200, 2]], seed: seed++ });
        }
      }
    } else {
      // Qanun: rippling arpeggios.
      for (let b = 0; b < plan.bars; b++) {
        const ch = chordAt(b);
        [0, 1, 2, 3, 2, 1].forEach((k, j) => pl(b * bar + j * (bar / 6), (ch[k % ch.length]! + 24) + (k === 3 ? 12 : 0), 0.16, 1.4, 0.9));
      }
    }
    // Oud melody: darker plucks, doubled an octave down by day.
    for (const n of line) {
      pl(n.t, n.midi - 12, 0.45, night ? 1.8 : 1.1, 0.4);
      if (!night && n.dur >= beat) pl(n.t + 0.01, n.midi - 24, 0.2, 1, 0.3);
    }
  } else {
    // Koto plucks (bright attack, long ring) and shakuhachi.
    for (let b = 0; b < plan.bars; b++) {
      const ch = chordAt(b);
      const pattern = night ? [0, 2] : [0, 1, 2, 3];
      pattern.forEach((k, j) => pl(b * bar + k * beat, ch[j % ch.length]! + 12, 0.22, 2.4, 0.8));
    }
    for (const n of line) {
      if (night || n.dur >= 2 * beat) {
        tone(out, n.t, n.dur * 0.97, midiHz(n.midi - (night ? 0 : 12)), shakuhachi);
        breath(out, n.t, n.dur * 0.97, midiHz(n.midi - (night ? 0 : 12)), seed++);
      } else {
        pl(n.t, n.midi, 0.4, 2, 0.85);
      }
    }
  }

  // Soft shaker on the off-beats by day (European waltz and Mediterranean).
  if (!night && (style === "european" || style === "mediterranean")) {
    for (let k = 0; k < plan.bars * plan.beatsPerBar * 2; k++) {
      noiseBurst(out, k * (beat / 2), 0.05, { amp: k % 2 ? 0.08 : 0.04, env: { a: 0.004, r: 0.04 }, filter: [["highpass", 6000]], seed: seed++ });
    }
  }

  // Lo-fi: a warm low-pass, a small room and a little more air at night.
  filterBuf(out, "lowpass", night ? 3800 : 5200);
  reverb(out, night ? 0.35 : 0.22, night ? 1.4 : 1);
  normalizeLoudness(out, 0.14);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ambience

/** Pink-ish noise (Paul Kellet's economy filter). */
function pinkNoise(buf: Buf, amp: number, r: () => number): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    buf.data[i]! += (b0 + b1 + b2 + w * 0.1848) * amp * 0.25;
  }
}

/** A slow random 0–1 modulator that repeats exactly over the loop (a sum of whole-cycle sines). */
function loopLfo(seconds: number, r: () => number, cycles: readonly number[]): (t: number) => number {
  const parts = cycles.map((c) => ({ f: c / seconds, ph: r() * TAU }));
  return (t) => 0.5 + 0.5 * (parts.reduce((s, p) => s + Math.sin(TAU * p.f * t + p.ph), 0) / parts.length);
}

export function renderAmbience(layer: AmbientLayer, seconds: number): Buf {
  const r = rng(seedOf(`amb.${layer}`));
  const out = new Buf(seconds, true);
  if (layer === "river") {
    // A low wash with a babbling mid band and bubbles.
    pinkNoise(out, 1, r);
    filterBuf(out, "lowpass", 900);
    const babble = new Buf(seconds, true);
    pinkNoise(babble, 1, r);
    const lfo = loopLfo(seconds, r, [3, 7, 11, 17]);
    const bp = new Biquad("bandpass", 700, 1.2);
    let i = 0;
    processBuf(babble, (x) => {
      const t = (i++ % babble.length) / SR;
      if (i % 64 === 0) bp.set("bandpass", 450 + 1100 * lfo(t), 1.2);
      return bp.step(x) * (0.4 + 0.6 * lfo(t));
    });
    for (let k = 0; k < out.length; k++) out.data[k]! += babble.data[k]! * 0.9;
    for (let k = 0; k < seconds * 6; k++) {
      const t = r() * seconds;
      const f0 = 300 + r() * 500;
      thump(out, t, { from: f0, to: f0 * 2.2, decay: 0.012, amp: 0.05 + r() * 0.05, dur: 0.05 });
    }
  } else if (layer === "birds") {
    // Calls of a few species: short whistled notes with sweeps and trills.
    const species = [
      { f: 3200, sweep: 1.4, notes: 4, len: 0.07, gap: 0.09 },
      { f: 4300, sweep: 0.75, notes: 2, len: 0.16, gap: 0.12 },
      { f: 2500, sweep: 1.15, notes: 6, len: 0.04, gap: 0.05 },
    ];
    let t = r() * 0.5;
    while (t < seconds) {
      const s = species[Math.floor(r() * species.length)]!;
      const amp = 0.25 + r() * 0.35;
      for (let k = 0; k < s.notes; k++) {
        const f = s.f * (0.92 + r() * 0.16);
        const start = Math.round((t + k * (s.len + s.gap)) * SR);
        let ph = 0;
        for (let i = 0; i < s.len * SR; i++) {
          const x = i / (s.len * SR);
          const fi = f * (1 + (s.sweep - 1) * x) * (1 + 0.04 * Math.sin(TAU * 40 * (i / SR)));
          ph += (TAU * fi) / SR;
          out.add(start + i, Math.sin(ph) * Math.sin(Math.PI * x) ** 2 * amp);
        }
      }
      t += s.notes * (s.len + s.gap) + 0.4 + r() * 1.6;
    }
    // A faint breeze under them.
    const air = new Buf(seconds, true);
    pinkNoise(air, 0.08, r);
    filterBuf(air, "lowpass", 500);
    for (let k = 0; k < out.length; k++) out.data[k]! += air.data[k]!;
  } else if (layer === "crickets") {
    // Three crickets chirping in pulse groups at their own rates, one far away.
    const crickets = [
      { f: 4400, pulse: 0.018, per: 3, every: 0.55, amp: 0.4 },
      { f: 4900, pulse: 0.015, per: 4, every: 0.8, amp: 0.3 },
      { f: 3900, pulse: 0.02, per: 2, every: 0.4, amp: 0.15 },
    ];
    for (const c of crickets) {
      const every = seconds / Math.round(seconds / c.every);
      for (let t = r() * every; t < seconds; t += every) {
        for (let k = 0; k < c.per; k++) {
          const start = Math.round((t + k * c.pulse * 2) * SR);
          for (let i = 0; i < c.pulse * SR; i++) {
            const x = i / (c.pulse * SR);
            out.add(start + i, Math.sin((TAU * c.f * i) / SR) * Math.sin(Math.PI * x) * c.amp);
          }
        }
      }
    }
    const air = new Buf(seconds, true);
    pinkNoise(air, 0.05, r);
    filterBuf(air, "lowpass", 400);
    for (let k = 0; k < out.length; k++) out.data[k]! += air.data[k]!;
  } else if (layer === "chatter") {
    // Distant murmur: several voices, a buzzy source through moving vowel formants, in phrases.
    const vowels = [
      [700, 1200],
      [400, 2000],
      [300, 900],
      [550, 1700],
      [350, 2300],
    ];
    for (let v = 0; v < 7; v++) {
      const pitch = 100 + r() * 140;
      let t = r() * 2;
      const voice = new Buf(seconds, true);
      while (t < seconds) {
        const phrase = 0.8 + r() * 2.2;
        const start = Math.round(t * SR);
        const n = Math.round(phrase * SR);
        let ph = 0;
        const f1 = new Biquad("bandpass", 500, 4);
        const f2 = new Biquad("bandpass", 1500, 5);
        let syll = 0;
        for (let i = 0; i < n; i++) {
          const ti = i / SR;
          if (i % Math.round(SR / 5) === 0) {
            const vowel = vowels[Math.floor(r() * vowels.length)]!;
            f1.set("bandpass", vowel[0]!, 4);
            f2.set("bandpass", vowel[1]!, 5);
            syll = 0;
          }
          syll++;
          const f = pitch * (1 + 0.08 * Math.sin(TAU * 1.3 * ti));
          ph = (ph + f / SR) % 1;
          const src = ph * 2 - 1;
          const env = Math.sin(Math.PI * Math.min(1, syll / (SR / 5))) * Math.min(1, ti / 0.05, (phrase - ti) / 0.1);
          voice.add(start + i, (f1.step(src) + 0.6 * f2.step(src)) * env * 0.5);
        }
        t += phrase + 0.3 + r() * 1.5;
      }
      for (let k = 0; k < out.length; k++) out.data[k]! += voice.data[k]! * (0.5 + r() * 0.5);
    }
    filterBuf(out, "lowpass", 2200);
    reverb(out, 0.45, 1.6);
    const crowd = new Buf(seconds, true);
    pinkNoise(crowd, 0.15, r);
    filterBuf(crowd, "bandpass", 600, 0.7);
    for (let k = 0; k < out.length; k++) out.data[k]! += crowd.data[k]!;
  } else {
    // Rain: a steady hiss and droplets.
    const r2 = rng(seedOf("rain.hiss"));
    for (let i = 0; i < out.length; i++) out.data[i] = (r2() * 2 - 1) * 0.3;
    filterBuf(out, "highpass", 900);
    filterBuf(out, "lowpass", 7000);
    for (let k = 0; k < seconds * 40; k++) {
      noiseBurst(out, r() * seconds, 0.02, { amp: 0.2 + r() * 0.3, env: { a: 0.0005, d: 0.006, s: 0.1, r: 0.012 }, filter: [["bandpass", 2000 + r() * 4000, 3]], seed: seedOf(`drop${k}`) });
    }
  }
  normalize(out, 0.6);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Footsteps

export function renderFootstep(surface: Surface, variant: number): Buf {
  const r = rng(seedOf(`step.${surface}.${variant}`));
  const v = 0.9 + r() * 0.2;
  const out = new Buf(0.3, false);
  const s = () => seedOf(`${surface}${variant}${r()}`);
  switch (surface) {
    case "grass":
      thump(out, 0, { from: 120, to: 70, decay: 0.025, amp: 0.25 });
      for (let k = 0; k < 6; k++) noiseBurst(out, 0.005 + r() * 0.12, 0.03, { amp: 0.3 + r() * 0.3, env: { a: 0.002, r: 0.025 }, filter: [["bandpass", 3500 * v, 1.2]], seed: s() });
      break;
    case "dirt":
      thump(out, 0, { from: 140 * v, to: 80, decay: 0.03, amp: 0.6 });
      noiseBurst(out, 0, 0.12, { amp: 0.5, env: { a: 0.002, d: 0.03, s: 0.3, r: 0.07 }, filter: [["bandpass", 1500 * v, 0.9]], seed: s() });
      break;
    case "cobble":
      thump(out, 0, { from: 160, to: 90, decay: 0.025, amp: 0.55 });
      thump(out, 0.003, { from: 700 * v, to: 600 * v, decay: 0.012, amp: 0.3 });
      noiseBurst(out, 0, 0.012, { amp: 0.7, env: { a: 0.0005, r: 0.01 }, filter: [["highpass", 4000]], seed: s() });
      noiseBurst(out, 0.02, 0.06, { amp: 0.15, env: { a: 0.002, r: 0.05 }, filter: [["bandpass", 2500, 1]], seed: s() });
      break;
    case "sand":
      for (let k = 0; k < 10; k++) noiseBurst(out, r() * 0.16, 0.04, { amp: 0.2 + r() * 0.2, env: { a: 0.01, r: 0.03 }, filter: [["lowpass", 3000 * v], ["highpass", 600]], seed: s() });
      thump(out, 0, { from: 100, to: 60, decay: 0.03, amp: 0.25 });
      break;
    case "wood":
      thump(out, 0, { from: 220 * v, to: 170 * v, decay: 0.05, amp: 0.6 });
      thump(out, 0, { from: 450 * v, to: 420 * v, decay: 0.025, amp: 0.3 });
      noiseBurst(out, 0, 0.008, { amp: 0.4, env: { a: 0.0005, r: 0.006 }, filter: [["bandpass", 2500, 1]], seed: s() });
      break;
    case "stone":
      thump(out, 0, { from: 180, to: 100, decay: 0.02, amp: 0.45 });
      thump(out, 0.002, { from: 950 * v, to: 900 * v, decay: 0.01, amp: 0.3 });
      noiseBurst(out, 0, 0.01, { amp: 0.8, env: { a: 0.0005, r: 0.008 }, filter: [["highpass", 5000]], seed: s() });
      break;
    case "tile":
      thump(out, 0, { from: 160, to: 100, decay: 0.02, amp: 0.35 });
      bell(out, 0.001, 1800 * v, { amp: 0.25, decay: 0.02, partials: [[1, 1], [1.72, 0.6], [2.9, 0.3]] });
      noiseBurst(out, 0, 0.008, { amp: 0.6, env: { a: 0.0005, r: 0.006 }, filter: [["highpass", 6000]], seed: s() });
      break;
  }
  edgeFades(out);
  normalize(out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Effects

export function renderSfx(id: SfxId): Buf {
  const r = rng(seedOf(id));
  const seed = () => Math.floor(r() * 2 ** 31);
  let out: Buf;
  switch (id) {
    case "ui.pop": {
      out = new Buf(0.09, false);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / SR;
        ph += (TAU * (500 + 700 * Math.min(1, t / 0.05))) / SR;
        out.add(i, Math.sin(ph) * Math.exp(-t / 0.025));
      }
      break;
    }
    case "ui.open":
    case "ui.close": {
      out = new Buf(0.45, false);
      const notes = id === "ui.open" ? [76, 83] : [83, 76];
      notes.forEach((m, k) => pluck(out, k * 0.07, midiHz(m), { amp: 0.6, decay: 0.35, bright: 0.6, seed: seed() }));
      break;
    }
    case "door.chime": {
      out = new Buf(1.8, false);
      bell(out, 0, midiHz(91), { amp: 0.5, decay: 0.5 });
      bell(out, 0.22, midiHz(88), { amp: 0.5, decay: 0.6 });
      break;
    }
    case "coins": {
      out = new Buf(0.6, false);
      let t = 0;
      for (let k = 0; k < 4; k++) {
        bell(out, t, 3000 + r() * 1800, { amp: 0.35, decay: 0.06, partials: [[1, 1], [1.48, 0.7], [2.03, 0.5], [2.71, 0.3]] });
        t += 0.06 + r() * 0.06;
      }
      break;
    }
    case "fish.cast": {
      out = new Buf(0.5, false);
      noiseBurst(out, 0, 0.45, { amp: 0.8, env: { a: 0.2, r: 0.2 }, filter: [["bandpass", 600, 2]], sweep: [600, 2600], seed: seed() });
      break;
    }
    case "fish.splash": {
      out = new Buf(0.8, false);
      noiseBurst(out, 0, 0.6, { amp: 0.9, env: { a: 0.004, d: 0.1, s: 0.4, r: 0.45 }, filter: [["lowpass", 3500, 0.8]], sweep: [3500, 400], seed: seed() });
      for (let k = 0; k < 8; k++) {
        const f0 = 400 + r() * 700;
        thump(out, 0.08 + r() * 0.5, { from: f0, to: f0 * 2, decay: 0.015, amp: 0.15, dur: 0.06 });
      }
      break;
    }
    case "fish.reel": {
      out = new Buf(0.75, false);
      for (let t = 0; t < 0.7; t += 0.04) {
        noiseBurst(out, t, 0.008, { amp: 0.6, env: { a: 0.0005, r: 0.006 }, filter: [["highpass", 3000]], seed: seed() });
        bell(out, t, 2500, { amp: 0.08, decay: 0.01, partials: [[1, 1], [2.3, 0.5]] });
      }
      break;
    }
    case "cook.sizzle": {
      out = new Buf(1.5, false);
      noiseBurst(out, 0, 1.5, { amp: 0.35, env: { a: 0.15, r: 0.5 }, filter: [["highpass", 2500], ["lowpass", 9000]], seed: seed() });
      for (let k = 0; k < 70; k++) {
        noiseBurst(out, 0.05 + r() * 1.3, 0.006, { amp: 0.3 + r() * 0.5, env: { a: 0.0005, r: 0.005 }, filter: [["highpass", 3000]], seed: seed() });
      }
      break;
    }
    case "pickup": {
      out = new Buf(0.7, false);
      [84, 88, 91].forEach((m, k) => pluck(out, k * 0.06, midiHz(m), { amp: 0.5, decay: 0.4, bright: 0.7, seed: seed() }));
      break;
    }
    case "page": {
      out = new Buf(0.35, false);
      noiseBurst(out, 0, 0.3, { amp: 0.8, env: { a: 0.06, d: 0.08, s: 0.5, r: 0.14 }, filter: [["bandpass", 1800, 0.8]], sweep: [1500, 4000], seed: seed() });
      break;
    }
  }
  edgeFades(out);
  normalize(out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Encoding

export function renderClip(def: AudioClipDef): Buf {
  const [, a, b] = def.id.split(".");
  if (def.kind === "music") return renderMusic(a as StyleId, b as MusicVariant, def.loopSeconds!);
  if (def.kind === "ambience") return renderAmbience(a as AmbientLayer, def.loopSeconds!);
  if (def.kind === "step") return renderFootstep(a as Surface, Number(b));
  return renderSfx(def.id as SfxId);
}

export function wavBytes(buf: Buf): Buffer {
  const n = buf.length;
  const out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + n * 2, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf.data[i]!)) * 32767), 44 + i * 2);
  return out;
}

const BITRATE: Record<AudioClipDef["kind"], string> = { music: "40k", ambience: "28k", step: "32k", sfx: "32k" };

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const outDir = join(root, "packages/client/public/assets/audio");
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg >= 0 ? process.argv[onlyArg + 1] : undefined;
  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "hv-audio-"));
  // The catalog drives the list; make sure every generator branch exists.
  const ids = [
    ...STYLE_IDS.flatMap((s) => MUSIC_VARIANTS.map((v) => musicTrackId(s, v))),
    ...AMBIENT_LAYERS.map((l) => `amb.${l}` as const),
    ...SURFACES.flatMap((s) => Array.from({ length: FOOTSTEP_VARIANTS }, (_, n) => footstepClipId(s, n))),
    ...SFX_IDS,
  ];
  let total = 0;
  try {
    for (const id of ids) {
      const def = AUDIO_CLIPS[id];
      if (only && def.file !== `${only}.ogg`) continue;
      const wav = join(tmp, def.file.replace(/\.ogg$/, ".wav"));
      writeFileSync(wav, wavBytes(renderClip(def)));
      const target = join(outDir, def.file);
      const res = spawnSync(
        "ffmpeg",
        ["-y", "-hide_banner", "-loglevel", "error", "-i", wav, "-ac", "1", "-c:a", "libopus", "-b:a", BITRATE[def.kind], "-application", "audio", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", target],
        { stdio: "inherit" },
      );
      if (res.status !== 0) throw new Error(`ffmpeg failed for ${def.file} (is ffmpeg with libopus on PATH?)`);
      const size = statSync(target).size;
      total += size;
      console.log(`${def.file.padEnd(32)} ${(size / 1024).toFixed(1).padStart(7)} KB`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`total ${(total / 1024).toFixed(1)} KB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
