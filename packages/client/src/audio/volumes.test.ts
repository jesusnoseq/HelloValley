// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_AUDIO_VOLUMES, sliderToGain } from "@hellovalley/shared";
import type { AudioSink } from "./engine";
import { routeVoice, setVoiceMixer, voiceElementUsable } from "./voiceRoute";
import { createVolumeStore, loadVolumesFor, readVolumes, setVolume, volumeKey, volumeStore } from "./volumeStore";

// Node's own (file-less) localStorage shadows jsdom's; use the jsdom window's.
vi.hoisted(() => {
  const { window } = (globalThis as unknown as { jsdom: { window: Window } }).jsdom;
  Object.defineProperty(globalThis, "localStorage", { value: window.localStorage, configurable: true, writable: true });
});

afterEach(() => {
  localStorage.clear();
  setVoiceMixer(null);
  loadVolumesFor(null);
});

describe("volume sliders, saved per player", () => {
  it("starts at the defaults and keeps each player's own volumes", () => {
    const store = createVolumeStore();
    loadVolumesFor("alice", store);
    expect(store.getState().volumes).toEqual(DEFAULT_AUDIO_VOLUMES);
    setVolume("music", 0.2, store);
    setVolume("sfx", 3, store);
    expect(store.getState().volumes).toEqual({ ...DEFAULT_AUDIO_VOLUMES, music: 0.2, sfx: 1 });
    expect(JSON.parse(localStorage.getItem(volumeKey("alice"))!)).toEqual(store.getState().volumes);

    loadVolumesFor("bob", store);
    expect(store.getState().volumes).toEqual(DEFAULT_AUDIO_VOLUMES);
    loadVolumesFor("alice", store);
    expect(store.getState().volumes.music).toBe(0.2);
  });

  it("survives broken or blocked storage", () => {
    localStorage.setItem(volumeKey("carol"), "{not json");
    expect(readVolumes("carol")).toEqual(DEFAULT_AUDIO_VOLUMES);
    const blocked = { getItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    expect(readVolumes("carol", blocked)).toEqual(DEFAULT_AUDIO_VOLUMES);
    const spy = vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const store = createVolumeStore();
    loadVolumesFor("carol", store);
    expect(() => setVolume("voice", 0.5, store)).not.toThrow();
    expect(store.getState().volumes.voice).toBe(0.5);
    spy.mockRestore();
  });
});

describe("voice lines through the mixer", () => {
  it("uses the element's own volume until the mixer runs", () => {
    loadVolumesFor("dave");
    setVolume("voice", 0.5);
    const el = document.createElement("audio");
    routeVoice(el);
    expect(el.volume).toBeCloseTo(sliderToGain(0.5));
    setVolume("voice", 1);
    expect(el.volume).toBe(1);
  });

  it("routes the element into the voice bus once, ducks while it plays, and retires it with the mixer", () => {
    loadVolumesFor("erin");
    setVolume("voice", 0.3);
    const connectVoice = vi.fn(() => true);
    const sink = { running: true, connectVoice } as unknown as AudioSink;
    const onVoiceActive = vi.fn();
    setVoiceMixer({ sink, onVoiceActive });
    const el = document.createElement("audio");
    routeVoice(el);
    routeVoice(el);
    expect(connectVoice).toHaveBeenCalledTimes(1);
    // The bus applies the slider; the element itself stays at full volume.
    expect(el.volume).toBe(1);
    el.dispatchEvent(new Event("playing"));
    expect(onVoiceActive).toHaveBeenLastCalledWith(true);
    el.dispatchEvent(new Event("ended"));
    expect(onVoiceActive).toHaveBeenLastCalledWith(false);
    expect(voiceElementUsable(el)).toBe(true);
    setVoiceMixer(null);
    expect(voiceElementUsable(el)).toBe(false);
    expect(voiceElementUsable(document.createElement("audio"))).toBe(true);
    expect(volumeStore.getState().uid).toBe("erin");
  });
});
