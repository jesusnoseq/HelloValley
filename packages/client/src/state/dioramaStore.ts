import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Type-only: importing values from shared here would pull zod into the entry chunk.
import type { StyleId, Weather } from "@hellovalley/shared";
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
  /** Day phase 0–1 (see scene/dayNight.ts). Online it follows the synced TownRoom clock (DayNightLights). */
  worldTime: number;
  /** Multiplier on the real 40-minute day for the local clock; 0 pauses it (dev tools). */
  timeScale: number;
  /** Optional tilt-shift depth of field. TODO(M37): expose in Settings with the other quality options. */
  tiltShift: boolean;
  /** All post-processing (AO, bloom, tilt-shift); off is the low-end fallback. */
  effects: boolean;
  /**
   * Town style the kits render in. Switching it swaps the kit under every building without
   * moving anything (scene/KitBuilding). App sets it from the player's profile; the Settings panel
   * switches it once the new kit is loaded (settings/styleSwitch, M34).
   */
  style: StyleId;
  /**
   * Cosmetic weather (GDD §4.3), a world-state value. With `weatherAuto` the scene follows the
   * shared weather schedule (`weatherAt` in shared/world/weather.ts) and `weather` is ignored;
   * dev pages pin a weather instead. Online the schedule is the TownRoom's broadcast weather.
   */
  weather: Weather;
  weatherAuto: boolean;
  rotate: (direction: -1 | 1) => void;
  zoom: (direction: number) => void;
  setWorldTime: (t: number) => void;
  setTimeScale: (scale: number) => void;
  setTiltShift: (on: boolean) => void;
  setEffects: (on: boolean) => void;
  setStyle: (style: StyleId) => void;
  /** Pin a weather (turns the schedule off); null goes back to the schedule. */
  setWeather: (weather: Weather | null) => void;
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
    style: "european",
    weather: "sun",
    weatherAuto: true,
    rotate: (direction) => set((s) => ({ cameraStep: s.cameraStep + direction })),
    zoom: (direction) => set((s) => ({ zoomLevel: stepZoomLevel(s.zoomLevel, direction) })),
    setWorldTime: (t) => set({ worldTime: wrapWorldTime(t) }),
    setTimeScale: (scale) => set({ timeScale: Math.max(0, scale) }),
    setTiltShift: (on) => set({ tiltShift: on }),
    setEffects: (on) => set({ effects: on }),
    setStyle: (style) => set({ style }),
    setWeather: (weather) => set(weather === null ? { weatherAuto: true } : { weather, weatherAuto: false }),
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
