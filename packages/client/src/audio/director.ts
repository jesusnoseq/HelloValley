import {
  type AmbienceLevels,
  ambienceLevels,
  type AudioVolumes,
  busGains,
  type MusicChoice,
  selectMusic,
  type SpaceId,
  type StyleId,
  type Vec2,
} from "@hellovalley/shared";
import type { AudioSink } from "./engine";

/** What the audio depends on: the player's style, the world clock, where they are, the weather. */
export interface AudioWorld {
  style: StyleId;
  /** In-game minutes since midnight. */
  minutes: number;
  space: SpaceId;
  pos: Vec2;
  /** Share of rain in the current weather, 0–1. */
  rain: number;
}

export interface AudioDirector {
  /** Re-read the world and update music and ambience (a few times a second). */
  tick(): void;
  setVolumes(volumes: AudioVolumes): void;
  /** An NPC voice line started or stopped: the music ducks under it. */
  setVoiceActive(active: boolean): void;
  readonly music: MusicChoice | null;
  readonly ambience: AmbienceLevels | null;
}

/**
 * The glue between the pure selection rules (shared/audio) and the mixer (build plan M35): every
 * tick picks the music for the style, time and place and the level of every ambient layer, and
 * hands them to the sink, which crossfades and eases. Bus gains follow the sliders and ducking.
 */
export function createAudioDirector(sink: AudioSink, read: () => AudioWorld, volumes: AudioVolumes): AudioDirector {
  let vols = volumes;
  let voice = false;
  let music: MusicChoice | null = null;
  let ambience: AmbienceLevels | null = null;
  const applyBuses = () => sink.setBusGains(busGains(vols, { voiceActive: voice }));
  applyBuses();
  return {
    tick() {
      const world = read();
      music = selectMusic(world);
      ambience = ambienceLevels(world);
      sink.setMusic(music);
      sink.setAmbience(ambience);
    },
    setVolumes(next) {
      vols = next;
      applyBuses();
    },
    setVoiceActive(active) {
      if (active === voice) return;
      voice = active;
      applyBuses();
    },
    get music() {
      return music;
    },
    get ambience() {
      return ambience;
    },
  };
}
