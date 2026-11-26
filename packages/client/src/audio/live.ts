import { type AudioClipId, FootstepTimer, footstepPlayback, type Motion, type SpaceId, surfaceAt, type Vec2 } from "@hellovalley/shared";
import { dioramaStore } from "../state/dioramaStore";

/**
 * The hook between the game and the audio system (build plan M35). The player controller writes
 * where the listener is every frame (`audioFrame`, which also times the footsteps), and anything
 * may call `playSfx`. Both do nothing until the audio system has started (`audio/start.ts`, after
 * sign-in) and attached its output, so dev pages and tests stay silent.
 */

export interface AudioOutput {
  play(id: AudioClipId, opts?: { gain?: number; rate?: number }): void;
}

let output: AudioOutput | null = null;

export function setAudioOutput(next: AudioOutput | null): void {
  output = next;
}

/** Where the listener (the local player) is; read by the audio director. */
export const audioLive: { space: SpaceId; pos: Vec2 | null; motion: Motion } = { space: "town", pos: null, motion: "idle" };

export function playSfx(id: AudioClipId, opts?: { gain?: number; rate?: number }): void {
  output?.play(id, opts);
}

const steps = new FootstepTimer();

/** Called by scene/Player.tsx every frame with the walker's state. */
export function audioFrame(space: SpaceId, pos: Vec2, motion: Motion, dt: number): void {
  audioLive.space = space;
  audioLive.pos = pos;
  audioLive.motion = motion;
  const n = steps.update(motion, dt);
  if (n === null || !output) return;
  const p = footstepPlayback(surfaceAt(space, pos, dioramaStore.getState().style), n, motion);
  output.play(p.clip, { gain: p.gain, rate: p.rate });
}
