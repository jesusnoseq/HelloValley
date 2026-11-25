import { describe, expect, it } from "vitest";
import { base64ToBytes, decodeTtsAudio, parseWav, pcmDurationMs, pcmToWav, rateFromMime } from "./pcm";

const samples = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]);

describe("TTS audio decoding", () => {
  it("decodes base64", () => {
    expect([...base64ToBytes(btoa("\x01\x02\xff"))]).toEqual([1, 2, 255]);
  });

  it("round-trips PCM through a 44-byte WAV header", () => {
    const wav = pcmToWav({ sampleRate: 24_000, data: samples });
    expect(wav.length).toBe(44 + samples.length);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(samples.length);
    expect(parseWav(wav)).toEqual({ sampleRate: 24_000, data: samples });
  });

  it("reads WAV whatever the mime type says", () => {
    const wav = pcmToWav({ sampleRate: 16_000, data: samples });
    expect(decodeTtsAudio("audio/x-wav", wav)).toEqual({ sampleRate: 16_000, data: samples });
    expect(decodeTtsAudio("audio/L16", wav)?.sampleRate).toBe(16_000);
  });

  it("reads raw L16 / PCM with the rate from the mime type", () => {
    expect(rateFromMime("audio/L16;codec=pcm;rate=24000")).toBe(24_000);
    expect(rateFromMime("audio/pcm")).toBe(24_000);
    expect(rateFromMime("audio/L16;rate=1")).toBe(24_000);
    expect(decodeTtsAudio("audio/L16;rate=22050", samples)).toEqual({ sampleRate: 22_050, data: samples });
    // An odd trailing byte is dropped.
    expect(decodeTtsAudio("audio/pcm", new Uint8Array([1, 0, 9]))?.data.length).toBe(2);
  });

  it("refuses other formats", () => {
    expect(decodeTtsAudio("audio/mpeg", samples)).toBeNull();
    const stereo = pcmToWav({ sampleRate: 24_000, data: samples });
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(parseWav(stereo)).toBeNull();
  });

  it("measures duration", () => {
    expect(pcmDurationMs({ sampleRate: 24_000, data: new Uint8Array(48_000) })).toBe(1000);
  });
});
