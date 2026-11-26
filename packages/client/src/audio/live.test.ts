import { afterEach, describe, expect, it, vi } from "vitest";
import { townPlaces } from "@hellovalley/shared";
import { dioramaStore } from "../state/dioramaStore";
import { audioFrame, audioLive, playSfx, setAudioOutput } from "./live";

afterEach(() => {
  setAudioOutput(null);
  dioramaStore.getState().setStyle("european");
});

describe("listener and footsteps", () => {
  it("tracks the walker and plays steps for the surface under it in the player's style", () => {
    const play = vi.fn();
    setAudioOutput({ play });
    const bridge = townPlaces().bridge;
    audioFrame("town", bridge, "idle", 0.016);
    expect(audioLive).toMatchObject({ space: "town", pos: bridge, motion: "idle" });
    audioFrame("town", bridge, "walk", 0.2);
    expect(play).toHaveBeenLastCalledWith(expect.stringMatching(/^step\.stone\.\d$/), expect.objectContaining({ rate: expect.any(Number) }));
    dioramaStore.getState().setStyle("japanese");
    audioFrame("town", bridge, "walk", 0.5);
    expect(play).toHaveBeenLastCalledWith(expect.stringMatching(/^step\.wood\.\d$/), expect.anything());
    audioFrame("cafe", [2, 2], "walk", 0.5);
    expect(play).toHaveBeenCalledTimes(3);
    expect(audioLive.space).toBe("cafe");
  });

  it("is silent before the audio system starts", () => {
    expect(() => playSfx("ui.pop")).not.toThrow();
    const play = vi.fn();
    setAudioOutput({ play });
    playSfx("coins", { gain: 0.5 });
    expect(play).toHaveBeenCalledWith("coins", { gain: 0.5 });
  });
});
