import { TTS_SAMPLE_RATE } from "@hellovalley/shared";

/**
 * Audio bytes from Gemini TTS (build plan M22). The docs disagree on what a unary
 * `generateContent` returns: raw 16-bit little-endian mono PCM (`audio/L16;rate=24000`,
 * `audio/pcm`) or the same PCM in a WAV container. Both are accepted; clips are kept as WAV so
 * an `<audio>` element can play them.
 */

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface Pcm16 {
  sampleRate: number;
  /** 16-bit little-endian mono samples. */
  data: Uint8Array;
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/** The PCM inside a RIFF/WAVE file, or null when it is not 16-bit mono PCM. */
export function parseWav(bytes: Uint8Array): Pcm16 | null {
  if (bytes.length < 12 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sampleRate = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      if (size < 16 || view.getUint16(body, true) !== 1 || view.getUint16(body + 2, true) !== 1 || view.getUint16(body + 14, true) !== 16) return null;
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === "data") {
      if (!sampleRate) return null;
      // Streaming writers put 0 or 0xFFFFFFFF as the size: take what is there.
      const end = Math.min(bytes.length, size === 0 || size === 0xffffffff ? bytes.length : body + size);
      return { sampleRate, data: bytes.slice(body, end - ((end - body) % 2)) };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** `audio/L16;rate=24000` → 24000 (Gemini's default when there is no rate). */
export function rateFromMime(mime: string): number {
  const m = /rate=(\d+)/i.exec(mime);
  const rate = m ? Number(m[1]) : TTS_SAMPLE_RATE;
  return rate >= 8000 && rate <= 96_000 ? rate : TTS_SAMPLE_RATE;
}

/** Decodes one TTS answer (WAV or raw PCM) into PCM, or null for anything else. */
export function decodeTtsAudio(mime: string, bytes: Uint8Array): Pcm16 | null {
  const wav = parseWav(bytes);
  if (wav) return wav;
  const m = mime.toLowerCase();
  if (!m.startsWith("audio/l16") && !m.startsWith("audio/pcm") && !m.startsWith("audio/x-raw")) return null;
  return { sampleRate: rateFromMime(mime), data: bytes.slice(0, bytes.length - (bytes.length % 2)) };
}

/** PCM in a 44-byte WAV header (24 kHz mono 16-bit by default). */
export function pcmToWav(pcm: Pcm16): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.data.length);
  const view = new DataView(out.buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.data.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.data.length, true);
  out.set(pcm.data, 44);
  return out;
}

export function pcmDurationMs(pcm: Pcm16): number {
  return Math.round((pcm.data.length / 2 / pcm.sampleRate) * 1000);
}
