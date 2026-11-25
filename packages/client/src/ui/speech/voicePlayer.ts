import type { TtsClip } from "../../ai/tts";

/** Plays one clip at a time; a new play stops the previous one. */
export interface VoicePlayer {
  play(clip: TtsClip, rate: number): Promise<void>;
  stop(): void;
}

/**
 * Clip playback (build plan M22). An `<audio>` element rather than an AudioBufferSourceNode:
 * at 0.75× a buffer source also drops the pitch (the Baker would sound like someone else), while
 * a media element keeps it (`preservesPitch`, on by default). Generated clips are PCM in a WAV
 * header and seeded clips are Ogg/Opus; Chrome plays both.
 */
export function createVoicePlayer(): VoicePlayer {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  const release = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
  return {
    async play(clip, rate) {
      audio ??= new Audio();
      audio.pause();
      release();
      url = URL.createObjectURL(new Blob([clip.data], { type: clip.mime }));
      audio.src = url;
      audio.preservesPitch = true;
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      await audio.play();
    },
    stop() {
      audio?.pause();
    },
  };
}

let shared: VoicePlayer | null = null;
/** The game's one voice player, so two NPC lines never talk over each other. */
export function voicePlayer(): VoicePlayer {
  shared ??= createVoicePlayer();
  return shared;
}
