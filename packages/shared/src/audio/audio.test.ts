import { describe, expect, it } from "vitest";
import { STYLE_IDS } from "../data/styles";
import { INTERIOR_IDS, interiorLayout } from "../world/interiors";
import { townPlaces, type Vec2 } from "../world/town";
import {
  AMBIENT_LAYERS,
  AUDIO_CLIPS,
  audioFileFor,
  FOOTSTEP_VARIANTS,
  footstepClipId,
  isAudioClipId,
  MUSIC_VARIANTS,
  musicTrackId,
  SFX_IDS,
  SURFACES,
} from "./catalog";
import { ambienceLevels, daylightAt, distanceToRiver, INDOOR_MUFFLE, interiorTownPoint, townActivityAt } from "./ambience";
import {
  busGains,
  crossfadeCurve,
  DEFAULT_AUDIO_VOLUMES,
  equalPowerCrossfade,
  parseAudioVolumes,
  sliderToGain,
  smoothGain,
  VOICE_DUCK_GAIN,
} from "./mix";
import { MUSIC_INDOOR_GAIN, musicVariantAt, selectMusic } from "./music";
import { FIRST_STEP_SECONDS, FootstepTimer, footstepPlayback, STEP_INTERVAL_SECONDS, surfaceAt } from "./surface";

const hours = (h: number) => h * 60;
const places = townPlaces();
const at = (pos: Vec2, minutes: number, rain = 0) => ambienceLevels({ space: "town", pos, minutes, rain });

describe("audio catalog", () => {
  it("has a day and a night loop for every style, every ambient layer, every surface and every SFX", () => {
    for (const style of STYLE_IDS) for (const v of MUSIC_VARIANTS) expect(AUDIO_CLIPS[musicTrackId(style, v)]?.loopSeconds).toBeGreaterThan(10);
    for (const layer of AMBIENT_LAYERS) expect(AUDIO_CLIPS[`amb.${layer}`]?.kind).toBe("ambience");
    for (const s of SURFACES) for (let n = 0; n < FOOTSTEP_VARIANTS; n++) expect(AUDIO_CLIPS[footstepClipId(s, n)]?.kind).toBe("step");
    for (const id of SFX_IDS) expect(AUDIO_CLIPS[id]?.kind).toBe("sfx");
    expect(Object.keys(AUDIO_CLIPS)).toHaveLength(STYLE_IDS.length * 2 + AMBIENT_LAYERS.length + SURFACES.length * FOOTSTEP_VARIANTS + SFX_IDS.length);
  });

  it("names files uniquely and recognises ids", () => {
    const files = Object.values(AUDIO_CLIPS).map((c) => c.file);
    expect(new Set(files).size).toBe(files.length);
    expect(audioFileFor("music.european.day")).toBe("music-european-day.ogg");
    expect(isAudioClipId("ui.pop")).toBe(true);
    expect(isAudioClipId("ui.boom")).toBe(false);
    expect(footstepClipId("wood", 4)).toBe("step.wood.1");
    expect(footstepClipId("wood", -1)).toBe("step.wood.2");
  });
});

describe("music selection (acceptance: responds to style and time)", () => {
  it("plays the style's own loop", () => {
    const tracks = STYLE_IDS.map((style) => selectMusic({ style, minutes: hours(10), space: "town" }).track);
    expect(tracks).toEqual(["music.european.day", "music.mediterranean.day", "music.arabic.day", "music.japanese.day"]);
  });

  it("switches to the night variant at sunset and back at sunrise", () => {
    expect(musicVariantAt(hours(20.9))).toBe("day");
    expect(musicVariantAt(hours(21))).toBe("night");
    expect(musicVariantAt(hours(2))).toBe("night");
    expect(musicVariantAt(hours(5.99))).toBe("night");
    expect(musicVariantAt(hours(6))).toBe("day");
    expect(selectMusic({ style: "japanese", minutes: hours(23), space: "town" }).track).toBe("music.japanese.night");
  });

  it("plays softer indoors (location)", () => {
    expect(selectMusic({ style: "arabic", minutes: hours(12), space: "town" }).gain).toBe(1);
    expect(selectMusic({ style: "arabic", minutes: hours(12), space: "cafe" })).toEqual({ track: "music.arabic.day", variant: "day", gain: MUSIC_INDOOR_GAIN });
  });
});

describe("ambience (acceptance: responds to location and time)", () => {
  it("hears the river by the water and not at the apartment block", () => {
    expect(at(places.fishing_dock, hours(10)).river).toBeCloseTo(1, 5);
    expect(at(places.bridge, hours(10)).river).toBeCloseTo(1, 5);
    expect(at(places.apartment_block, hours(10)).river).toBe(0);
    const mid = at([37, 40], hours(10)).river;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(distanceToRiver([37, 29])).toBe(0);
  });

  it("has birds by day, crickets by night and both through twilight", () => {
    const noon = at(places.library, hours(13));
    const midnight = at(places.library, hours(0));
    expect(noon.birds).toBeGreaterThan(0.6);
    expect(noon.crickets).toBe(0);
    expect(midnight.birds).toBe(0);
    expect(midnight.crickets).toBe(1);
    const dusk = at(places.library, hours(21));
    expect(dusk.birds).toBeGreaterThan(0);
    expect(dusk.crickets).toBeGreaterThan(0);
    // The dawn chorus is louder than the afternoon.
    expect(at(places.library, hours(6.75)).birds).toBeGreaterThan(at(places.library, hours(15)).birds);
    expect(daylightAt(hours(12))).toBe(1);
    expect(daylightAt(hours(3))).toBe(0);
  });

  it("hears chatter on the square while the town is awake", () => {
    expect(at(places.town_square, hours(11)).chatter).toBeCloseTo(1, 5);
    expect(at(places.town_square, hours(2)).chatter).toBe(0);
    expect(at(places.elder_cottage, hours(11)).chatter).toBe(0);
    expect(townActivityAt(hours(12))).toBe(1);
  });

  it("follows the rain: a rain bed, fewer birds and crickets", () => {
    const dry = at(places.library, hours(12));
    const wet = at(places.library, hours(12), 1);
    expect(dry.rain).toBe(0);
    expect(wet.rain).toBe(1);
    expect(wet.birds).toBeLessThan(dry.birds);
    expect(at(places.library, hours(1), 1).crickets).toBeLessThan(at(places.library, hours(1)).crickets);
  });

  it("muffles the outside indoors, as heard at the building's door", () => {
    const gossip = ambienceLevels({ space: "gossip_house", pos: [2, 2], minutes: hours(11), rain: 0 });
    const outside = at(interiorTownPoint("gossip_house"), hours(11));
    expect(gossip.chatter).toBeCloseTo(outside.chatter * INDOOR_MUFFLE, 6);
    expect(gossip.birds).toBeCloseTo(outside.birds * INDOOR_MUFFLE, 6);
    // The café has its own customers by day, not at night.
    expect(ambienceLevels({ space: "cafe", pos: [2, 2], minutes: hours(11), rain: 0 }).chatter).toBeGreaterThan(0.5);
    expect(ambienceLevels({ space: "cafe", pos: [2, 2], minutes: hours(3), rain: 0 }).chatter).toBe(0);
    // Rain drums on every roof.
    const rainy = ambienceLevels({ space: "library", pos: [1, 1], minutes: hours(12), rain: 1 });
    expect(rainy.rain).toBeGreaterThan(0.2);
    expect(rainy.rain).toBeLessThan(1);
    for (const id of INTERIOR_IDS) {
      const l = ambienceLevels({ space: id, pos: [1, 1], minutes: hours(12), rain: 0.5 });
      for (const layer of AMBIENT_LAYERS) {
        expect(l[layer]).toBeGreaterThanOrEqual(0);
        expect(l[layer]).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("footstep surfaces (acceptance: location and style)", () => {
  it("reads the town ground", () => {
    expect(surfaceAt("town", places.town_square, "european")).toBe("cobble");
    expect(surfaceAt("town", [36, 20], "european")).toBe("dirt");
    expect(surfaceAt("town", [10, 60], "european")).toBe("grass");
  });

  it("walks on the bridge and dock decks: stone, or wood in the Japanese town", () => {
    expect(surfaceAt("town", places.bridge, "european")).toBe("stone");
    expect(surfaceAt("town", places.bridge, "arabic")).toBe("stone");
    expect(surfaceAt("town", places.bridge, "japanese")).toBe("wood");
    expect(surfaceAt("town", places.fishing_dock, "mediterranean")).toBe("wood");
  });

  it("uses each interior's floor", () => {
    for (const id of INTERIOR_IDS) {
      const floor = interiorLayout(id).floor.module;
      expect(surfaceAt(id, [1, 1], "european")).toBe(floor === "floor.wood" ? "wood" : floor === "floor.tile" ? "tile" : "stone");
    }
  });

  it("times steps by walking pace and restarts after standing still", () => {
    const timer = new FootstepTimer();
    expect(timer.update("idle", 1)).toBeNull();
    expect(timer.update("walk", FIRST_STEP_SECONDS / 2)).toBeNull();
    expect(timer.update("walk", FIRST_STEP_SECONDS / 2 + 0.001)).toBe(0);
    let steps = 0;
    for (let i = 0; i < 100; i++) if (timer.update("walk", 0.01) !== null) steps++;
    expect(steps).toBe(Math.floor(1 / STEP_INTERVAL_SECONDS.walk));
    let runSteps = 0;
    for (let i = 0; i < 100; i++) if (timer.update("run", 0.01) !== null) runSteps++;
    expect(runSteps).toBeGreaterThan(steps);
    timer.update("idle", 0.016);
    expect(timer.update("walk", FIRST_STEP_SECONDS + 0.001)).not.toBeNull();
    // A long frame never fires a burst of steps.
    expect(timer.update("walk", 5)).not.toBeNull();
    expect(timer.update("walk", 0.01)).toBeNull();
  });

  it("varies clip, pitch and level per step", () => {
    const a = footstepPlayback("grass", 0, "walk");
    const b = footstepPlayback("grass", 1, "walk");
    expect(a.clip).not.toBe(b.clip);
    for (let n = 0; n < 20; n++) {
      const p = footstepPlayback("cobble", n, "walk");
      expect(p.rate).toBeGreaterThanOrEqual(0.93);
      expect(p.rate).toBeLessThanOrEqual(1.07);
      expect(footstepPlayback("cobble", n, "run").gain).toBeGreaterThan(p.gain);
    }
  });
});

describe("mixing", () => {
  it("parses saved volumes with defaults and clamping", () => {
    expect(parseAudioVolumes(null)).toEqual(DEFAULT_AUDIO_VOLUMES);
    expect(parseAudioVolumes({ music: 2, voice: -1, sfx: "x" })).toEqual({ music: 1, voice: 0, sfx: DEFAULT_AUDIO_VOLUMES.sfx });
    expect(parseAudioVolumes({ music: 0.3, voice: 0.4, sfx: Number.NaN })).toEqual({ music: 0.3, voice: 0.4, sfx: DEFAULT_AUDIO_VOLUMES.sfx });
  });

  it("maps sliders to gains with a square law and ducks music under a voice line", () => {
    expect(sliderToGain(0)).toBe(0);
    expect(sliderToGain(1)).toBe(1);
    expect(sliderToGain(0.5)).toBeCloseTo(0.25);
    const vols = { music: 1, voice: 0.5, sfx: 1 };
    expect(busGains(vols).music).toBe(1);
    expect(busGains(vols, { voiceActive: true }).music).toBeCloseTo(VOICE_DUCK_GAIN);
    expect(busGains(vols).voice).toBeCloseTo(0.25);
    expect(busGains({ ...vols, sfx: 0 }).ambience).toBe(0);
  });

  it("crossfades with equal power", () => {
    for (let t = 0; t <= 1; t += 0.1) {
      const g = equalPowerCrossfade(t);
      expect(g.out ** 2 + g.in ** 2).toBeCloseTo(1, 6);
    }
    expect(equalPowerCrossfade(0)).toEqual({ out: 1, in: 0 });
    expect(equalPowerCrossfade(1).out).toBeCloseTo(0, 9);
    const fadeIn = crossfadeCurve("in", 16, 0.7);
    const fadeOut = crossfadeCurve("out", 16, 0.7);
    expect(fadeIn[0]).toBe(0);
    expect(fadeIn[15]).toBeCloseTo(0.7, 6);
    expect(fadeOut[0]).toBeCloseTo(0.7, 6);
    expect(fadeOut[15]).toBeCloseTo(0, 6);
    for (let i = 1; i < 16; i++) {
      expect(fadeIn[i]!).toBeGreaterThan(fadeIn[i - 1]!);
      expect(fadeOut[i]!).toBeLessThan(fadeOut[i - 1]!);
    }
  });

  it("smooths gains towards a target", () => {
    let g = 0;
    for (let i = 0; i < 60; i++) g = smoothGain(g, 1, 0.1, 1.5);
    expect(g).toBeGreaterThan(0.98);
    expect(smoothGain(0.3, 0.8, 0, 1)).toBe(0.3);
    expect(smoothGain(0.3, 0.8, 0.1, 0)).toBe(0.8);
  });
});
