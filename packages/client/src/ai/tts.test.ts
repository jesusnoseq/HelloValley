import { buildTtsRequest, type TtsRequest } from "@hellovalley/shared";
import { describe, expect, it, vi } from "vitest";
import { type PersistentStore, sha256Hex } from "./cache";
import { pcmToWav } from "./pcm";
import { createTts, type SeededTtsReader, type TtsClip, type TtsDeps, type TtsLineRequest } from "./tts";

const memoryStore = (): PersistentStore & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
};

/** 0.1 s of a 24 kHz tone as raw PCM. */
const pcm = () => {
  const samples = new Int16Array(2400).map((_, i) => Math.round(Math.sin(i / 8) * 8000));
  return new Uint8Array(samples.buffer);
};

const mockPort = () => {
  const calls: TtsRequest[] = [];
  const port = vi.fn(async (request: TtsRequest) => {
    calls.push(request);
    return { mime: "audio/L16;codec=pcm;rate=24000", data: pcm() };
  });
  return { port, calls };
};

const line = (over: Partial<TtsLineRequest> = {}): TtsLineRequest => ({ npcId: "baker", lang: "es", level: "A1", text: "¡Hola, cariño!", ...over });

function make(over: Partial<TtsDeps> = {}) {
  const logs: string[] = [];
  const { port, calls } = mockPort();
  const persistent = memoryStore();
  const tts = createTts({ port, cloudEnabled: true, persistent, log: (m) => logs.push(m), warn: () => {}, ...over });
  return { tts, port: (over.port as typeof port | undefined) ?? port, calls, persistent, logs };
}

describe("TTS acceptance: the same line twice", () => {
  it("generates once, then serves the second play from cache (logged)", async () => {
    const { tts, port, calls, logs } = make();
    const first = await tts.clip(line());
    const second = await tts.clip(line());
    expect(first).toMatchObject({ ok: true, source: "generated" });
    expect(second).toMatchObject({ ok: true, source: "memory" });
    expect(port).toHaveBeenCalledTimes(1);
    expect(second.ok && first.ok && second.clip).toBe(first.ok && first.clip);
    expect(logs).toEqual([expect.stringMatching(/^tts: generated [0-9a-f]{12}$/), expect.stringMatching(/^tts: served from cache \(memory\) [0-9a-f]{12}$/)]);
    // One call with the NPC's voice, style (A1 pace hint) and transcript.
    expect(calls[0]).toEqual(buildTtsRequest(line()));
    expect(calls[0]!.voiceName).toBe("Sulafat");
    expect(calls[0]!.style).toMatch(/slower/);
  });

  it("serves it from the player's IndexedDB in the next session", async () => {
    const a = make();
    await a.tts.clip(line());
    const { port, calls } = mockPort();
    const next = createTts({ port, cloudEnabled: true, persistent: a.persistent, log: () => {} });
    const r = await next.clip(line());
    expect(r).toMatchObject({ ok: true, source: "idb" });
    expect(calls).toHaveLength(0);
    // Keyed by sha256(ttsKeyMaterial(line)).
    const hash = await sha256Hex(buildTtsRequest(line())!.keyMaterial);
    expect(r.ok && r.hash).toBe(hash);
    expect([...a.persistent.data.keys()]).toEqual([hash]);
  });

  it("stores the clip as WAV", async () => {
    const { tts } = make();
    const r = await tts.clip(line());
    if (!r.ok) throw new Error("expected a clip");
    expect(r.clip.mime).toBe("audio/wav");
    expect(new TextDecoder().decode(new Uint8Array(r.clip.data, 0, 4))).toBe("RIFF");
    expect(r.clip.durationMs).toBe(100);
  });

  it("shares one generation between concurrent requests", async () => {
    const { tts, port } = make();
    const [a, b] = await Promise.all([tts.clip(line()), tts.clip(line())]);
    expect(port).toHaveBeenCalledTimes(1);
    expect(a.ok && b.ok).toBe(true);
  });

  it("caches the same line whatever tags or emotion come with it", async () => {
    const { tts, port } = make();
    await tts.clip(line());
    const r = await tts.clip(line({ ttsTags: "<laugh> ¡Hola, cariño!", emotion: "happy" }));
    expect(r).toMatchObject({ source: "memory" });
    expect(port).toHaveBeenCalledTimes(1);
  });

  it("generates a new clip for another level or NPC", async () => {
    const { tts, port } = make();
    await tts.clip(line());
    await tts.clip(line({ level: "B1" }));
    await tts.clip(line({ npcId: "farmer" }));
    expect(port).toHaveBeenCalledTimes(3);
  });
});

describe("seeded clips", () => {
  const seededClip: TtsClip = { mime: "audio/ogg", data: new Uint8Array(200).fill(1).buffer, durationMs: 900 };

  it("reads cache/tts for seeded lines, with the NPC's voice, before generating", async () => {
    const seeded: SeededTtsReader = { get: vi.fn(async () => seededClip) };
    const { tts, port, persistent } = make({ seeded });
    const r = await tts.clip(line({ seeded: true }));
    expect(r).toMatchObject({ ok: true, source: "seeded", clip: seededClip });
    const hash = await sha256Hex(buildTtsRequest(line())!.keyMaterial);
    expect(seeded.get).toHaveBeenCalledWith(hash, "Sulafat");
    expect(port).not.toHaveBeenCalled();
    // Shared clips are not copied into the player's store.
    expect(persistent.data.size).toBe(0);
    expect(await tts.clip(line({ seeded: true }))).toMatchObject({ source: "memory" });
  });

  it("skips the seeded lookup for play-time lines", async () => {
    const seeded: SeededTtsReader = { get: vi.fn(async () => seededClip) };
    const { tts } = make({ seeded });
    expect(await tts.clip(line())).toMatchObject({ source: "generated" });
    expect(seeded.get).not.toHaveBeenCalled();
  });

  it("generates on a seeded miss or a failing reader", async () => {
    const miss = make({ seeded: { get: async () => null } });
    expect(await miss.tts.clip(line({ seeded: true }))).toMatchObject({ source: "generated" });
    const broken = make({ seeded: { get: async () => Promise.reject(new Error("offline")) } });
    expect(await broken.tts.clip(line({ seeded: true }))).toMatchObject({ source: "generated" });
  });
});

describe("fallbacks", () => {
  it("is unavailable without a cloud backend, with no call", async () => {
    const { tts, port } = make({ cloudEnabled: false });
    expect(await tts.clip(line())).toEqual({ ok: false, reason: "unavailable" });
    expect(port).not.toHaveBeenCalled();
  });

  it("still plays cached clips without a cloud backend", async () => {
    const a = make();
    await a.tts.clip(line());
    const offline = createTts({ port: vi.fn(), cloudEnabled: false, persistent: a.persistent, log: () => {} });
    expect(await offline.clip(line())).toMatchObject({ ok: true, source: "idb" });
  });

  it("refuses lines it cannot voice", async () => {
    const { tts, port } = make();
    expect(await tts.clip(line({ npcId: "ghost" }))).toEqual({ ok: false, reason: "unavailable" });
    expect(await tts.clip(line({ text: " " }))).toEqual({ ok: false, reason: "unavailable" });
    expect(port).not.toHaveBeenCalled();
  });

  it("does not cache failures", async () => {
    const port = vi.fn().mockRejectedValueOnce(new Error("quota")).mockResolvedValue({ mime: "audio/pcm", data: pcm() });
    const { tts, persistent } = make({ port });
    expect(await tts.clip(line())).toEqual({ ok: false, reason: "failed" });
    expect(persistent.data.size).toBe(0);
    expect(await tts.clip(line())).toMatchObject({ ok: true, source: "generated" });
  });

  it("rejects unusable audio", async () => {
    const port = vi.fn(async () => ({ mime: "audio/mpeg", data: new Uint8Array(100) }));
    const { tts } = make({ port });
    expect(await tts.clip(line())).toEqual({ ok: false, reason: "failed" });
  });

  it("accepts a WAV answer", async () => {
    const wav = pcmToWav({ sampleRate: 24_000, data: pcm() });
    const port = vi.fn(async () => ({ mime: "audio/wav", data: wav }));
    const { tts } = make({ port });
    const r = await tts.clip(line());
    expect(r.ok && r.clip.data.byteLength).toBe(wav.byteLength);
  });

  it("ignores a corrupt stored entry and regenerates", async () => {
    const { tts, port, persistent } = make();
    const hash = await sha256Hex(buildTtsRequest(line())!.keyMaterial);
    persistent.data.set(hash, { mime: "audio/wav", data: "not bytes", durationMs: 1 });
    expect(await tts.clip(line())).toMatchObject({ source: "generated" });
    expect(port).toHaveBeenCalledTimes(1);
  });
});
