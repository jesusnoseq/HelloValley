import { describe, expect, it } from "vitest";
import { AUDIO_CLIPS, SFX_IDS, SURFACES } from "../../packages/shared/src/audio/catalog";
import { renderAmbience, renderClip, renderFootstep, renderMusic, renderSfx, SAMPLE_RATE, wavBytes } from "../../tools/audio/generate-audio";

const peak = (d: Float32Array) => d.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const finite = (d: Float32Array) => d.every(Number.isFinite);

describe("procedural placeholder audio (tools/audio/generate-audio.ts)", () => {
  it("renders every footstep and effect as a short, clean one-shot", () => {
    for (const s of SURFACES) {
      const b = renderFootstep(s, 0);
      expect(finite(b.data)).toBe(true);
      expect(peak(b.data)).toBeCloseTo(0.7, 3);
      expect(b.data[b.length - 1]).toBe(0);
    }
    for (const id of SFX_IDS) {
      const b = renderSfx(id);
      expect(finite(b.data), id).toBe(true);
      expect(peak(b.data), id).toBeGreaterThan(0.5);
      expect(b.length / SAMPLE_RATE, id).toBeLessThan(2);
    }
  });

  it("renders loops of the catalog's length that wrap without a jump", () => {
    const music = renderMusic("japanese", "night", AUDIO_CLIPS["music.japanese.night"].loopSeconds!);
    expect(music.length).toBe(AUDIO_CLIPS["music.japanese.night"].loopSeconds! * SAMPLE_RATE);
    expect(finite(music.data)).toBe(true);
    expect(peak(music.data)).toBeLessThanOrEqual(0.95 + 1e-6);
    const river = renderAmbience("river", 12);
    expect(Math.abs(river.data[0]! - river.data[river.length - 1]!)).toBeLessThan(0.05);
  });

  it("is deterministic and writes 16-bit mono WAV", () => {
    const a = renderClip(AUDIO_CLIPS["step.cobble.2"]);
    const b = renderClip(AUDIO_CLIPS["step.cobble.2"]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const wav = wavBytes(a);
    expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.length).toBe(44 + a.length * 2);
  });
});
