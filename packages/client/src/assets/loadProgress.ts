import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Asset loading progress for the preloading screen (build plan M37): every kit manifest, atlas,
 * module GLB, character GLB and the scene chunk goes through `trackLoad`, which counts what
 * started and what finished (failures count as finished; whoever asked handles the error).
 */

export interface LoadProgress {
  started: number;
  finished: number;
  /** performance.now() of the last start or finish. */
  changedAt: number;
}

export type LoadProgressStore = StoreApi<LoadProgress>;

export function createLoadProgress(): LoadProgressStore {
  return createStore<LoadProgress>()(() => ({ started: 0, finished: 0, changedAt: 0 }));
}

export const loadProgress = createLoadProgress();

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

export function trackLoad<T>(work: Promise<T>, store: LoadProgressStore = loadProgress): Promise<T> {
  store.setState((s) => ({ started: s.started + 1, changedAt: now() }));
  const done = () => store.setState((s) => ({ finished: s.finished + 1, changedAt: now() }));
  work.then(done, done);
  return work;
}

/** `fetch`, counted by the loading screen. */
export function trackedFetch(url: string): Promise<Response> {
  return trackLoad(fetch(url));
}

/** Nothing pending, and nothing started or finished for `quietMs`. */
export function isSettled(p: LoadProgress, at: number, quietMs: number): boolean {
  return p.started > 0 && p.finished >= p.started && at - p.changedAt >= quietMs;
}

export function useLoadProgress<T>(selector: (p: LoadProgress) => T, store: LoadProgressStore = loadProgress): T {
  return useStore(store, selector);
}
