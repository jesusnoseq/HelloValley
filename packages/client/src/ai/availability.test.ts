import { afterEach, describe, expect, it } from "vitest";
import { aiChipMessage } from "../ui/AiStatusChip";
import {
  aiStatusStore,
  checkOnDeviceAvailability,
  onDeviceReady,
  refreshOnDeviceStatus,
  reportDownloadProgress,
  reportWarmUpDone,
} from "./availability";
import { createIdbStore, createLru, sha256Hex } from "./cache";

const lm = (answer: string | Error) => ({
  availability: async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  },
});

afterEach(() => aiStatusStore.setState({ onDevice: "unknown", progress: null, justReady: false }));

describe("on-device availability", () => {
  it("maps the Prompt API answers", async () => {
    expect(await checkOnDeviceAvailability(undefined)).toBe("unsupported");
    expect(await checkOnDeviceAvailability(lm("available"))).toBe("available");
    expect(await checkOnDeviceAvailability(lm("downloadable"))).toBe("downloadable");
    expect(await checkOnDeviceAvailability(lm("downloading"))).toBe("downloading");
    expect(await checkOnDeviceAvailability(lm("unavailable"))).toBe("unavailable");
    expect(await checkOnDeviceAvailability(lm("something new"))).toBe("unavailable");
    expect(await checkOnDeviceAvailability(lm(new Error("blocked")))).toBe("unavailable");
  });

  it("tracks the warm-up download in the store", async () => {
    await refreshOnDeviceStatus(lm("downloadable"));
    expect(aiStatusStore.getState().onDevice).toBe("downloadable");
    expect(onDeviceReady()).toBe(false);
    reportDownloadProgress(0.42);
    expect(aiStatusStore.getState()).toMatchObject({ onDevice: "downloading", progress: 0.42 });
    // A check during our own download does not wipe the progress.
    await refreshOnDeviceStatus(lm("downloading"));
    expect(aiStatusStore.getState().progress).toBe(0.42);
    reportWarmUpDone(true);
    expect(aiStatusStore.getState()).toEqual({ onDevice: "available", progress: null, justReady: true });
    expect(onDeviceReady()).toBe(true);
  });

  it("drives the status chip", () => {
    expect(aiChipMessage({ onDevice: "downloadable", progress: null, justReady: false })).toBeNull();
    expect(aiChipMessage({ onDevice: "unsupported", progress: null, justReady: false })).toBeNull();
    expect(aiChipMessage({ onDevice: "downloading", progress: null, justReady: false })).toEqual({ key: "ai.chip.downloading" });
    expect(aiChipMessage({ onDevice: "downloading", progress: 0.256, justReady: false })).toEqual({ key: "ai.chip.progress", percent: 26 });
    expect(aiChipMessage({ onDevice: "available", progress: null, justReady: true })).toEqual({ key: "ai.chip.ready" });
  });
});

describe("cache helpers", () => {
  it("hashes with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("evicts the least recently used entry", () => {
    const lru = createLru<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a");
    lru.set("c", 3);
    expect(lru.get("b")).toBeUndefined();
    expect(lru.get("a")).toBe(1);
    expect(lru.size).toBe(2);
  });

  it("degrades to a store that never hits without IndexedDB", async () => {
    const store = createIdbStore("uid", 10, undefined);
    await store.set("k", 1);
    expect(await store.get("k")).toBeUndefined();
    const throwing = { open: () => { throw new Error("SecurityError"); } } as unknown as IDBFactory;
    const blocked = createIdbStore("uid", 10, throwing);
    await expect(blocked.set("k", 1)).resolves.toBeUndefined();
    await expect(blocked.get("k")).resolves.toBeUndefined();
  });
});
