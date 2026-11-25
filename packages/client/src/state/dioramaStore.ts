import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { DEFAULT_ZOOM_LEVEL, stepZoomLevel } from "../scene/cameraMath";
import { wrapWorldTime } from "../scene/dayNight";

/**
 * UI state of the diorama view (architecture §4: Zustand holds UI state only). The render loop
 * reads it with `getState()` every frame instead of subscribing, so camera easing never re-renders
 * React.
 */
export interface DioramaState {
  /** Unwrapped 90° rotation step (Q/E). The camera eases towards it. */
  cameraStep: number;
  /** Index into ZOOM_LEVELS. */
  zoomLevel: number;
  /** Day phase 0–1 (see scene/dayNight.ts). TODO(M16): mirror the TownRoom world clock. */
  worldTime: number;
  /** Multiplier on the real 40-minute day for the local clock; 0 pauses it (dev tools). */
  timeScale: number;
  /** Optional tilt-shift depth of field. TODO(M37): expose in Settings with the other quality options. */
  tiltShift: boolean;
  /** All post-processing (AO, bloom, tilt-shift); off is the low-end fallback. */
  effects: boolean;
  rotate: (direction: -1 | 1) => void;
  zoom: (direction: number) => void;
  setWorldTime: (t: number) => void;
  setTimeScale: (scale: number) => void;
  setTiltShift: (on: boolean) => void;
  setEffects: (on: boolean) => void;
}

/** Sunny late morning: a pleasant first impression before the server clock arrives. */
export const INITIAL_WORLD_TIME = 0.2;

export function createDioramaStore(initial: Partial<Pick<DioramaState, "worldTime" | "timeScale">> = {}) {
  return createStore<DioramaState>()((set) => ({
    cameraStep: 0,
    zoomLevel: DEFAULT_ZOOM_LEVEL,
    worldTime: wrapWorldTime(initial.worldTime ?? INITIAL_WORLD_TIME),
    timeScale: initial.timeScale ?? 1,
    tiltShift: true,
    effects: true,
    rotate: (direction) => set((s) => ({ cameraStep: s.cameraStep + direction })),
    zoom: (direction) => set((s) => ({ zoomLevel: stepZoomLevel(s.zoomLevel, direction) })),
    setWorldTime: (t) => set({ worldTime: wrapWorldTime(t) }),
    setTimeScale: (scale) => set({ timeScale: Math.max(0, scale) }),
    setTiltShift: (on) => set({ tiltShift: on }),
    setEffects: (on) => set({ effects: on }),
  }));
}

export const dioramaStore = createDioramaStore();

export function useDiorama<T>(selector: (state: DioramaState) => T): T {
  return useStore(dioramaStore, selector);
}

/** Latest dev perf sample, written by the render loop twice a second. */
export interface PerfSample {
  fps: number;
  worstMs: number;
  calls: number;
  triangles: number;
  dpr: number;
}

export const perfStore = createStore<PerfSample | null>()(() => null);

export function usePerf(): PerfSample | null {
  return useStore(perfStore);
}
