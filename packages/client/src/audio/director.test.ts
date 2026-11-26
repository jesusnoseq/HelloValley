import { describe, expect, it } from "vitest";
import { type AmbienceLevels, type BusGains, type MusicChoice, townPlaces, VOICE_DUCK_GAIN } from "@hellovalley/shared";
import { type AudioWorld, createAudioDirector } from "./director";
import type { AudioSink } from "./engine";

function fakeSink() {
  const calls = { music: [] as (MusicChoice | null)[], ambience: [] as AmbienceLevels[], buses: [] as BusGains[] };
  const sink: AudioSink = {
    setBusGains: (g) => calls.buses.push(g),
    setMusic: (c) => calls.music.push(c),
    setAmbience: (l) => calls.ambience.push(l),
    play: () => {},
    preload: () => {},
    connectVoice: () => false,
    running: true,
    resume: async () => {},
    dispose: () => {},
  };
  return { sink, calls };
}

const places = townPlaces();

describe("audio director (acceptance: audio responds to location, time and style)", () => {
  it("drives the music and ambience from the world", () => {
    const { sink, calls } = fakeSink();
    const world: AudioWorld = { style: "european", minutes: 10 * 60, space: "town", pos: places.fishing_dock, rain: 0 };
    const director = createAudioDirector(sink, () => world, { music: 1, voice: 1, sfx: 1 });

    director.tick();
    expect(calls.music.at(-1)?.track).toBe("music.european.day");
    expect(calls.ambience.at(-1)?.river).toBeGreaterThan(0.9);
    expect(calls.ambience.at(-1)?.crickets).toBe(0);

    // Style: the Settings switch changes the loop.
    world.style = "japanese";
    director.tick();
    expect(calls.music.at(-1)?.track).toBe("music.japanese.day");

    // Time: night brings the night loop and the crickets.
    world.minutes = 23 * 60;
    director.tick();
    expect(calls.music.at(-1)?.track).toBe("music.japanese.night");
    expect(calls.ambience.at(-1)?.crickets).toBeGreaterThan(0.9);
    expect(calls.ambience.at(-1)?.birds).toBe(0);

    // Location: away from the river, onto the square by day, then indoors.
    world.minutes = 11 * 60;
    world.pos = places.town_square;
    director.tick();
    expect(calls.ambience.at(-1)?.river).toBeLessThan(0.5);
    expect(calls.ambience.at(-1)?.chatter).toBeGreaterThan(0.9);
    world.space = "cafe";
    world.pos = [2, 2];
    director.tick();
    expect(calls.music.at(-1)?.gain).toBeLessThan(1);
    expect(calls.ambience.at(-1)?.birds).toBeLessThan(0.2);
    expect(director.music?.track).toBe("music.japanese.day");
  });

  it("sets bus gains from the sliders and ducks the music under a voice line", () => {
    const { sink, calls } = fakeSink();
    const director = createAudioDirector(sink, () => ({ style: "arabic", minutes: 600, space: "town", pos: [0, 0], rain: 0 }), { music: 1, voice: 1, sfx: 0.5 });
    expect(calls.buses.at(-1)).toMatchObject({ music: 1, voice: 1, sfx: 0.25 });
    director.setVoiceActive(true);
    expect(calls.buses.at(-1)?.music).toBeCloseTo(VOICE_DUCK_GAIN);
    director.setVoiceActive(true);
    expect(calls.buses).toHaveLength(2);
    director.setVoiceActive(false);
    director.setVolumes({ music: 0, voice: 0.5, sfx: 1 });
    expect(calls.buses.at(-1)).toMatchObject({ music: 0, voice: 0.25, sfx: 1 });
  });
});
