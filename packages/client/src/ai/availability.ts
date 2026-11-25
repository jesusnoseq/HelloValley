import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

/**
 * On-device model status (architecture §5.2 "Warm-up", GDD §9.2). At login the client asks
 * Chrome's Prompt API `LanguageModel.availability()`. If the model is `downloadable`, the
 * download starts during character creation (it needs a user gesture) through Firebase AI Logic
 * (`GenerativeModel.initializeDeviceModel`, in `runtime.ts`), and a status chip shows progress.
 *
 * This file stays free of zod and `firebase/ai`, so the chip and the check live in the entry chunk.
 */

export type OnDeviceStatus =
  /** Not checked yet. */
  | "unknown"
  /** No Prompt API in this browser (not Chrome desktop, or the flag is off). */
  | "unsupported"
  /** The device cannot run the model (hardware, policy, disk). */
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export interface AiStatus {
  onDevice: OnDeviceStatus;
  /** Download progress 0–1 while this session downloads the model, else null. */
  progress: number | null;
  /** This session finished a download (the chip says so for a moment). */
  justReady: boolean;
}

export const aiStatusStore = createStore<AiStatus>()(() => ({ onDevice: "unknown", progress: null, justReady: false }));

export const useAiStatus = <T>(selector: (s: AiStatus) => T): T => useStore(aiStatusStore, selector);

/** The part of Chrome's `LanguageModel` global used here. */
export interface LanguageModelLike {
  availability(options?: unknown): Promise<string>;
}

const languageModel = (): LanguageModelLike | undefined => (globalThis as { LanguageModel?: LanguageModelLike }).LanguageModel;

/** Asks the Prompt API how the on-device model is doing. Never throws. */
export async function checkOnDeviceAvailability(lm: LanguageModelLike | undefined = languageModel()): Promise<OnDeviceStatus> {
  if (!lm || typeof lm.availability !== "function") return "unsupported";
  try {
    const a = await lm.availability();
    return a === "available" || a === "downloadable" || a === "downloading" ? a : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** How often a download that this session did not start is re-checked (ms, my number). */
export const DOWNLOAD_POLL_MS = 15_000;
let polling: ReturnType<typeof setTimeout> | null = null;

/** Checks availability and updates the store (and polls while another context downloads). */
export async function refreshOnDeviceStatus(lm?: LanguageModelLike): Promise<OnDeviceStatus> {
  const status = await checkOnDeviceAvailability(lm ?? languageModel());
  const current = aiStatusStore.getState();
  // A download this session drives reports its own progress; do not overwrite it.
  if (!(current.progress !== null && status === "downloading")) aiStatusStore.setState({ onDevice: status });
  if (status === "downloading" && current.progress === null && polling === null && typeof setTimeout === "function") {
    polling = setTimeout(() => {
      polling = null;
      void refreshOnDeviceStatus(lm);
    }, DOWNLOAD_POLL_MS);
  }
  return status;
}

/** Download progress from `initializeDeviceModel` (0–1). */
export function reportDownloadProgress(progress: number) {
  aiStatusStore.setState({ onDevice: "downloading", progress: Math.min(1, Math.max(0, progress)) });
}

/** The warm-up ended: ready, or back to what the Prompt API says. */
export function reportWarmUpDone(ok: boolean) {
  if (ok) aiStatusStore.setState({ onDevice: "available", progress: null, justReady: true });
  else {
    aiStatusStore.setState({ progress: null });
    void refreshOnDeviceStatus();
  }
}

export const clearJustReady = () => aiStatusStore.setState({ justReady: false });

/** Is the on-device model ready for ONLY_ON_DEVICE tasks? */
export const onDeviceReady = () => aiStatusStore.getState().onDevice === "available";
