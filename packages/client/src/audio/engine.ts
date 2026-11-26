import {
  AMBIENCE_TAU_SECONDS,
  AMBIENT_LAYERS,
  type AmbienceLevels,
  ambientClipId,
  type AmbientLayer,
  AUDIO_CLIPS,
  type AudioClipId,
  BUS_TAU_SECONDS,
  type BusGains,
  crossfadeCurve,
  MUSIC_CROSSFADE_SECONDS,
  type MusicChoice,
} from "@hellovalley/shared";

/**
 * What the audio director drives (build plan M35). The Web Audio implementation is below; tests
 * use a recording fake.
 */
export interface AudioSink {
  setBusGains(gains: BusGains): void;
  /** The music to play; a different track crossfades, the same track only changes level. */
  setMusic(choice: MusicChoice | null): void;
  /** Target level of every ambient layer (eased by the sink). */
  setAmbience(levels: AmbienceLevels): void;
  play(id: AudioClipId, opts?: { gain?: number; rate?: number }): void;
  /** Fetch and decode clips ahead of their first use. */
  preload(ids: readonly AudioClipId[]): void;
  /** Route a media element (the NPC voice player) through the voice bus. False when it cannot. */
  connectVoice(el: HTMLMediaElement): boolean;
  readonly running: boolean;
  resume(): Promise<void>;
  dispose(): void;
}

/** Where the clips are served (Vite's public dir). */
export function audioUrl(file: string, baseUrl: string = import.meta.env.BASE_URL ?? "/"): string {
  return `${baseUrl.replace(/\/+$/, "")}/assets/audio/${file}`;
}

interface Deck {
  track: AudioClipId;
  src: AudioBufferSourceNode;
  gain: GainNode;
  /** Level the deck sits at once its fade is over. */
  level: number;
  /** Context time when its crossfade ends (no other automation before then). */
  fadeUntil: number;
}

interface Layer {
  gain: GainNode;
  started: boolean;
}

const CURVE_POINTS = 64;

/**
 * The Web Audio mixer: four buses (music, voice, effects, ambience) into the speakers; two music
 * decks that crossfade on equal-power curves; one looping source per ambient layer, started on
 * first use and eased towards its level; one-shot sources for footsteps and effects. Clips are
 * fetched and decoded once.
 */
export function createWebAudioSink(ctx: AudioContext, fetchClip: (url: string) => Promise<ArrayBuffer> = (url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${url}: ${r.status}`))))): AudioSink {
  const bus = (): GainNode => {
    const g = ctx.createGain();
    g.connect(ctx.destination);
    return g;
  };
  const buses = { music: bus(), voice: bus(), sfx: bus(), ambience: bus() };
  const buffers = new Map<AudioClipId, Promise<AudioBuffer | null>>();
  const load = (id: AudioClipId): Promise<AudioBuffer | null> => {
    let p = buffers.get(id);
    if (!p) {
      p = fetchClip(audioUrl(AUDIO_CLIPS[id].file))
        .then((data) => ctx.decodeAudioData(data))
        .catch((error: unknown) => {
          console.warn("audio: could not load", id, error);
          return null;
        });
      buffers.set(id, p);
    }
    return p;
  };
  const loopSource = (id: AudioClipId, buffer: AudioBuffer): AudioBufferSourceNode => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const loopSeconds = AUDIO_CLIPS[id].loopSeconds;
    if (loopSeconds && loopSeconds <= buffer.duration) {
      src.loopStart = 0;
      src.loopEnd = loopSeconds;
    }
    return src;
  };

  let current: Deck | null = null;
  let wanted: MusicChoice | null = null;
  const fadeOut = (deck: Deck, now: number) => {
    const g = deck.gain.gain;
    const from = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(from, now);
    if (from > 0.0005) g.setValueCurveAtTime(crossfadeCurve("out", CURVE_POINTS, from), now, MUSIC_CROSSFADE_SECONDS);
    deck.src.stop(now + MUSIC_CROSSFADE_SECONDS + 0.05);
    deck.src.onended = () => deck.gain.disconnect();
  };
  const startTrack = async (choice: MusicChoice) => {
    const buffer = await load(choice.track);
    if (!buffer || wanted?.track !== choice.track || current?.track === choice.track) return;
    const now = ctx.currentTime;
    if (current) fadeOut(current, now);
    const level = wanted.gain * AUDIO_CLIPS[choice.track].gain;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.setValueCurveAtTime(crossfadeCurve("in", CURVE_POINTS, level), now, MUSIC_CROSSFADE_SECONDS);
    gain.connect(buses.music);
    const src = loopSource(choice.track, buffer);
    src.connect(gain);
    src.start(now);
    current = { track: choice.track, src, gain, level, fadeUntil: now + MUSIC_CROSSFADE_SECONDS };
  };

  const layers = new Map<AmbientLayer, Layer>();
  const layerFor = (layer: AmbientLayer): Layer => {
    let l = layers.get(layer);
    if (!l) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(buses.ambience);
      l = { gain, started: false };
      layers.set(layer, l);
    }
    return l;
  };

  return {
    get running() {
      return ctx.state === "running";
    },
    setBusGains(g) {
      const now = ctx.currentTime;
      for (const k of ["music", "voice", "sfx", "ambience"] as const) buses[k].gain.setTargetAtTime(g[k], now, BUS_TAU_SECONDS);
    },
    setMusic(choice) {
      wanted = choice;
      const now = ctx.currentTime;
      if (!choice) {
        if (current) fadeOut(current, now);
        current = null;
        return;
      }
      if (current?.track === choice.track) {
        const level = choice.gain * AUDIO_CLIPS[choice.track].gain;
        if (Math.abs(level - current.level) > 1e-3 && now >= current.fadeUntil) {
          current.level = level;
          current.gain.gain.setTargetAtTime(level, now, 0.6);
        }
        return;
      }
      void startTrack(choice);
    },
    setAmbience(levels) {
      const now = ctx.currentTime;
      for (const layer of AMBIENT_LAYERS) {
        const target = (levels[layer] ?? 0) * AUDIO_CLIPS[ambientClipId(layer)].gain;
        const l = layers.get(layer);
        if (!l && target < 1e-3) continue;
        const ll = l ?? layerFor(layer);
        if (!ll.started) {
          ll.started = true;
          const id = ambientClipId(layer);
          void load(id).then((buffer) => {
            if (!buffer) return;
            const src = loopSource(id, buffer);
            src.connect(ll.gain);
            // Start each layer at a different point of its loop so they never line up.
            src.start(ctx.currentTime, Math.random() * Math.min(buffer.duration, AUDIO_CLIPS[id].loopSeconds ?? buffer.duration));
          });
        }
        ll.gain.gain.setTargetAtTime(target, now, AMBIENCE_TAU_SECONDS);
      }
    },
    play(id, opts = {}) {
      void load(id).then((buffer) => {
        if (!buffer || ctx.state !== "running") return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = opts.rate ?? 1;
        const gain = ctx.createGain();
        gain.gain.value = AUDIO_CLIPS[id].gain * (opts.gain ?? 1);
        src.connect(gain).connect(buses.sfx);
        src.onended = () => gain.disconnect();
        src.start();
      });
    },
    preload(ids) {
      for (const id of ids) void load(id);
    },
    connectVoice(el) {
      if (ctx.state !== "running") return false;
      try {
        ctx.createMediaElementSource(el).connect(buses.voice);
        return true;
      } catch (error) {
        console.warn("audio: voice routing failed", error);
        return false;
      }
    },
    resume() {
      return ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
    },
    dispose() {
      void ctx.close();
    },
  };
}

/** The small clips worth loading early (footsteps and effects). */
export function oneShotIds(): AudioClipId[] {
  return Object.values(AUDIO_CLIPS)
    .filter((c) => c.kind === "step" || c.kind === "sfx")
    .map((c) => c.id);
}
