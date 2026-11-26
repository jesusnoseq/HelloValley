import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { type AudioChannel, type AudioVolumes, DEFAULT_AUDIO_VOLUMES, clampVolume, parseAudioVolumes } from "@hellovalley/shared";

/**
 * The three volume sliders (build plan M35): music, voices and effects (ambience follows the
 * effects slider). Saved per player in this browser's localStorage (`hv-audio-<uid>`): loudness
 * depends on the device (speakers or headphones), so it is not synced to the profile. Every access
 * is wrapped, so private mode or blocked storage just keeps the defaults for the session.
 */

export interface VolumeState {
  uid: string | null;
  volumes: AudioVolumes;
}

export type VolumeStore = StoreApi<VolumeState>;

export const volumeKey = (uid: string) => `hv-audio-${uid}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readVolumes(uid: string, store: Storage | null = storage()): AudioVolumes {
  try {
    const raw = store?.getItem(volumeKey(uid));
    return parseAudioVolumes(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_AUDIO_VOLUMES };
  }
}

function writeVolumes(uid: string, volumes: AudioVolumes, store: Storage | null = storage()): void {
  try {
    store?.setItem(volumeKey(uid), JSON.stringify(volumes));
  } catch {
    // Storage full or blocked: the volumes still apply for this session.
  }
}

export function createVolumeStore(): VolumeStore {
  return createStore<VolumeState>()(() => ({ uid: null, volumes: { ...DEFAULT_AUDIO_VOLUMES } }));
}

export const volumeStore = createVolumeStore();

/** Switch to a player's saved volumes (sign-in), or back to the defaults (null). */
export function loadVolumesFor(uid: string | null, store: VolumeStore = volumeStore): void {
  store.setState({ uid, volumes: uid ? readVolumes(uid) : { ...DEFAULT_AUDIO_VOLUMES } });
}

/** Move one slider; the new volumes are saved for the current player. */
export function setVolume(channel: AudioChannel, value: number, store: VolumeStore = volumeStore): void {
  const { uid, volumes } = store.getState();
  const next = { ...volumes, [channel]: clampVolume(value, volumes[channel]) };
  store.setState({ volumes: next });
  if (uid) writeVolumes(uid, next);
}

export function useVolumes<T>(selector: (s: VolumeState) => T, store: VolumeStore = volumeStore): T {
  return useStore(store, selector);
}
