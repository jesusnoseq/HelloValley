import { buildTtsRequest, estimateTtsSeconds, type TtsLine, type TtsRequest } from "@hellovalley/shared";
import type { AiBudget } from "./budget";
import { createLru, type PersistentStore, sha256Hex } from "./cache";
import { decodeTtsAudio, pcmDurationMs, pcmToWav } from "./pcm";

/**
 * NPC voices (build plan M22, architecture §5.4). The client calls Gemini TTS through Firebase
 * AI Logic with the NPC's prebuilt voice and style; the game server never calls a model. Lookup
 * order for a line, keyed by `sha256(ttsKeyMaterial(line))`:
 *
 * 1. the session's memory LRU;
 * 2. seeded content (openers, barks, labels, intro): `cache/tts/{hash}` → the Storage clip, which
 *    only the admin seeding tool writes (architecture §6.3);
 * 3. the player's own IndexedDB (`hv-tts-{uid}`);
 * 4. otherwise one TTS call; the clip goes to memory and IndexedDB, never to a shared cache.
 *
 * A failure is not cached and gives `{ok: false}`: the line stays text only, with a 🔇 badge.
 * So does a used-up TTS budget (build plan M36): only step 4 costs anything, so cached and seeded
 * clips still play; a generated clip is charged its real length.
 * Text is always shown first; callers ask for audio after the text is on screen.
 */

export interface TtsClip {
  /** `audio/wav` for generated clips (PCM in a WAV header), `audio/ogg` for seeded Opus clips. */
  mime: "audio/wav" | "audio/ogg";
  data: ArrayBuffer;
  durationMs: number;
}

/** Re-validates a stored entry (IndexedDB can hold anything an old build wrote). */
export function isTtsClip(value: unknown): value is TtsClip {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<TtsClip>;
  return (
    (v.mime === "audio/wav" || v.mime === "audio/ogg") &&
    v.data instanceof ArrayBuffer &&
    v.data.byteLength > 44 &&
    typeof v.durationMs === "number" &&
    Number.isFinite(v.durationMs) &&
    v.durationMs >= 0
  );
}

export type TtsSource = "memory" | "seeded" | "idb" | "generated";
export type TtsResult = { ok: true; clip: TtsClip; source: TtsSource; hash: string } | { ok: false; reason: "unavailable" | "failed" };

/** A line to voice; `seeded` marks shared content that may have a seeded clip. */
export interface TtsLineRequest extends TtsLine {
  seeded?: boolean;
}

/** One TTS call: the audio bytes of the first candidate (base64 already decoded). */
export type TtsPort = (request: TtsRequest) => Promise<{ mime: string; data: Uint8Array }>;

/** Reads a seeded clip (`cache/tts/{hash}` → Storage); null on a miss. Never throws. */
export interface SeededTtsReader {
  get(hash: string, voice: string): Promise<TtsClip | null>;
}

export interface TtsSpeaker {
  clip(line: TtsLineRequest): Promise<TtsResult>;
}

export interface TtsDeps {
  port: TtsPort;
  /** False without a cloud backend (the `demo-*` emulator project, no API key). */
  cloudEnabled: boolean;
  /** The player's IndexedDB clip store; null before sign-in. */
  persistent: PersistentStore | null;
  seeded?: SeededTtsReader | null;
  memoryMax?: number;
  log?: (message: string) => void;
  warn?: (message: string, error: unknown) => void;
  /** The player's TTS seconds budget (build plan M36). */
  budget?: Pick<AiBudget, "allow" | "charge">;
}

/** Clips kept in memory per session (my number: a 5 s clip is about 240 kB). */
export const TTS_MEMORY_MAX_CLIPS = 64;
/** Clips kept in the player's IndexedDB (my number: about 50 MB of short lines). */
export const TTS_IDB_MAX_CLIPS = 200;

export function createTts(deps: TtsDeps): TtsSpeaker {
  const memory = createLru<TtsClip>(deps.memoryMax ?? TTS_MEMORY_MAX_CLIPS);
  const inFlight = new Map<string, Promise<TtsResult>>();
  const log = deps.log ?? ((m: string) => console.debug(m));
  const warn = deps.warn ?? ((m: string, e: unknown) => console.warn(m, e));

  const served = (clip: TtsClip, source: TtsSource, hash: string): TtsResult => {
    log(`tts: ${source === "generated" ? "generated" : `served from cache (${source})`} ${hash.slice(0, 12)}`);
    return { ok: true, clip, source, hash };
  };

  const load = async (line: TtsLineRequest, request: TtsRequest, hash: string): Promise<TtsResult> => {
    if (line.seeded && deps.seeded) {
      const clip = await deps.seeded.get(hash, request.voiceName).catch(() => null);
      if (clip) {
        memory.set(hash, clip);
        return served(clip, "seeded", hash);
      }
    }
    if (deps.persistent) {
      const stored = await deps.persistent.get(hash);
      if (isTtsClip(stored)) {
        memory.set(hash, stored);
        return served(stored, "idb", hash);
      }
    }
    if (!deps.cloudEnabled) return { ok: false, reason: "unavailable" };
    if (deps.budget && !deps.budget.allow("tts", estimateTtsSeconds(request.transcript))) return { ok: false, reason: "unavailable" };
    try {
      const answer = await deps.port(request);
      const pcm = decodeTtsAudio(answer.mime, answer.data);
      if (!pcm || pcm.data.length === 0) {
        warn(`tts: unusable audio (${answer.mime}, ${answer.data.length} bytes)`, null);
        return { ok: false, reason: "failed" };
      }
      const clip: TtsClip = { mime: "audio/wav", data: pcmToWav(pcm).buffer, durationMs: pcmDurationMs(pcm) };
      deps.budget?.charge("tts", clip.durationMs / 1000);
      memory.set(hash, clip);
      await deps.persistent?.set(hash, clip);
      return served(clip, "generated", hash);
    } catch (error) {
      warn("tts: generation failed", error);
      return { ok: false, reason: "failed" };
    }
  };

  return {
    async clip(line) {
      const request = buildTtsRequest(line);
      if (!request) return { ok: false, reason: "unavailable" };
      const hash = await sha256Hex(request.keyMaterial);
      const hit = memory.get(hash);
      if (hit) return served(hit, "memory", hash);
      let pending = inFlight.get(hash);
      if (!pending) {
        pending = load(line, request, hash).finally(() => inFlight.delete(hash));
        inFlight.set(hash, pending);
      }
      return pending;
    },
  };
}
