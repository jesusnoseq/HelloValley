import { describe, expect, it } from "vitest";
import { AUDIO_CLIPS, MUSIC_CROSSFADE_SECONDS, selectMusic } from "@hellovalley/shared";
import { audioUrl, createWebAudioSink } from "./engine";

/** A recording stand-in for the bits of Web Audio the sink uses. */
class FakeParam {
  value = 1;
  events: [string, ...unknown[]][] = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.events.push(["set", v, t]);
  }
  setValueCurveAtTime(curve: Float32Array, t: number, d: number) {
    // As read after the curve has run.
    this.value = curve[curve.length - 1]!;
    this.events.push(["curve", Array.from(curve), t, d]);
  }
  setTargetAtTime(v: number, t: number, tau: number) {
    this.events.push(["target", v, t, tau]);
  }
  cancelScheduledValues(t: number) {
    this.events.push(["cancel", t]);
  }
}

function fakeContext() {
  const sources: FakeSource[] = [];
  const gains: FakeGain[] = [];
  class FakeNode {
    connected: unknown[] = [];
    connect<T>(n: T): T {
      this.connected.push(n);
      return n;
    }
    disconnect() {}
  }
  class FakeGain extends FakeNode {
    gain = new FakeParam();
  }
  class FakeSource extends FakeNode {
    buffer: { duration: number; id: string } | null = null;
    loop = false;
    loopStart = 0;
    loopEnd = 0;
    playbackRate = new FakeParam();
    started: number[] = [];
    stopped: number[] = [];
    onended: (() => void) | null = null;
    start(t = 0) {
      this.started.push(t);
    }
    stop(t = 0) {
      this.stopped.push(t);
    }
  }
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: {},
    createGain: () => {
      const g = new FakeGain();
      gains.push(g);
      return g;
    },
    createBufferSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    decodeAudioData: async (data: ArrayBuffer) => ({ duration: 30, id: new TextDecoder().decode(data) }),
    createMediaElementSource: () => new FakeNode(),
    resume: async () => {},
    close: async () => {},
  };
  return { ctx: ctx as unknown as AudioContext, raw: ctx, sources, gains };
}

const fetchClip = async (url: string) => new TextEncoder().encode(url).buffer as ArrayBuffer;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Web Audio sink", () => {
  it("serves clips from public/assets/audio", () => {
    expect(audioUrl("ui-pop.ogg", "/")).toBe("/assets/audio/ui-pop.ogg");
    expect(audioUrl("ui-pop.ogg", "/game/")).toBe("/game/assets/audio/ui-pop.ogg");
  });

  it("crossfades music on equal-power curves when the track changes, and loops exactly the loop span", async () => {
    const { ctx, raw, sources } = fakeContext();
    const sink = createWebAudioSink(ctx, fetchClip);
    const day = selectMusic({ style: "european", minutes: 600, space: "town" });
    sink.setMusic(day);
    await flush();
    const first = sources.at(-1)!;
    expect(first.buffer?.id).toContain("music-european-day.ogg");
    expect(first.loop).toBe(true);
    expect(first.loopEnd).toBe(AUDIO_CLIPS["music.european.day"].loopSeconds);
    expect(first.started).toEqual([0]);

    // The same track again: no new source.
    sink.setMusic(day);
    await flush();
    expect(sources).toHaveLength(1);

    raw.currentTime = 20;
    sink.setMusic(selectMusic({ style: "european", minutes: 23 * 60, space: "town" }));
    await flush();
    const second = sources.at(-1)!;
    expect(second.buffer?.id).toContain("music-european-night.ogg");
    expect(second.started).toEqual([20]);
    expect(first.stopped[0]).toBeCloseTo(20 + MUSIC_CROSSFADE_SECONDS + 0.05);
    const inGain = second.connected[0] as { gain: FakeParam };
    const curve = inGain.gain.events.find((e) => e[0] === "curve")!;
    expect(curve[2]).toBe(20);
    expect(curve[3]).toBe(MUSIC_CROSSFADE_SECONDS);
    expect((curve[1] as number[])[0]).toBe(0);
    const outGain = first.connected[0] as { gain: FakeParam };
    expect(outGain.gain.events.some((e) => e[0] === "curve" && e[2] === 20)).toBe(true);
  });

  it("starts ambient loops on first use and eases them towards their levels", async () => {
    const { ctx, sources } = fakeContext();
    const sink = createWebAudioSink(ctx, fetchClip);
    sink.setAmbience({ river: 0, birds: 0, crickets: 0, chatter: 0, rain: 0 });
    await flush();
    expect(sources).toHaveLength(0);
    sink.setAmbience({ river: 1, birds: 0.5, crickets: 0, chatter: 0, rain: 0 });
    await flush();
    expect(sources.map((s) => s.buffer?.id).sort()).toEqual([expect.stringContaining("amb-birds"), expect.stringContaining("amb-river")]);
    sink.setAmbience({ river: 0.2, birds: 0.5, crickets: 0, chatter: 0, rain: 0 });
    await flush();
    expect(sources).toHaveLength(2);
  });

  it("plays one-shots through the effects bus with their rate", async () => {
    const { ctx, sources } = fakeContext();
    const sink = createWebAudioSink(ctx, fetchClip);
    sink.play("step.wood.1", { rate: 1.05, gain: 0.9 });
    await flush();
    const s = sources.at(-1)!;
    expect(s.buffer?.id).toContain("step-wood-1.ogg");
    expect(s.playbackRate.value).toBe(1.05);
    expect(s.started).toHaveLength(1);
  });
});
