// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LABEL_KEYS, WORLD_LABELS_BATCH, type WorldLabelsPromptInput } from "@hellovalley/shared";
import type { TaskResult } from "../ai/hybrid";
import type { TtsClip, TtsSpeaker } from "../ai/tts";
import { chatPieces } from "../ui/chat/ChatWords";
import { LabelChip } from "../ui/labels/LabelChip";
import { onSaveWord } from "../ui/speech/wordEvents";
import type { VoicePlayer } from "../ui/speech/voicePlayer";
import { createLabelSource, LABEL_RETRY_MS, seededLabelsReader } from "./labelSource";
import { labelStore, requestLabels, setLabelLoader } from "./labelStore";

/** A fake generator that labels every key it is asked for as `<lang>:<english>`. */
function generator(fail = false) {
  return vi.fn(async (input: WorldLabelsPromptInput): Promise<TaskResult<{ labels: { key: string; word: string; reading?: string }[] }>> => {
    if (fail) return { ok: false, reason: "failed" };
    return { ok: true, source: "cloud", value: { labels: input.items.map((i) => ({ key: i.key, word: `${input.targetLang}:${i.english}` })) } };
  });
}

afterEach(cleanup);

describe("label source (seeded cache/labels/{lang}, then per-player generation)", () => {
  it("uses the seeded document and generates only the missing keys, in batches", async () => {
    const generate = generator();
    const seeded = vi.fn(async () => ({ "item.bread": { word: "pan" }, "prop.bench": { word: "banco", audioHash: "b".repeat(64) } }));
    const source = createLabelSource({ seeded, generate });
    const load = await source.load("es");
    expect(load.complete).toBe(true);
    expect(load.labels["item.bread"]).toEqual({ word: "pan" });
    expect(load.labels["prop.bench"]?.audioHash).toBe("b".repeat(64));
    expect(load.labels["item.milk"]).toEqual({ word: "es:milk" });
    expect(generate).toHaveBeenCalledTimes(Math.ceil((LABEL_KEYS.length - 2) / WORLD_LABELS_BATCH));
    for (const call of generate.mock.calls) expect(call[0].items.map((i) => i.key)).not.toContain("item.bread");
    // A second load is served from memory.
    await source.load("es");
    expect(seeded).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(Math.ceil((LABEL_KEYS.length - 2) / WORLD_LABELS_BATCH));
  });

  it("keeps a partial result and retries the failed batches later", async () => {
    let now = 0;
    let fail = true;
    const generate = vi.fn(async (input: WorldLabelsPromptInput) => (fail ? ({ ok: false, reason: "unavailable" } as const) : generator()(input)));
    const source = createLabelSource({ seeded: async () => null, generate, now: () => now });
    expect((await source.load("ja")).complete).toBe(false);
    const calls = generate.mock.calls.length;
    await source.load("ja");
    expect(generate.mock.calls.length).toBe(calls);
    now += LABEL_RETRY_MS + 1;
    fail = false;
    expect((await source.load("ja")).complete).toBe(true);
  });

  it("treats a malformed or missing seeded document as a miss", async () => {
    expect(await seededLabelsReader(async () => ({ exists: true, data: { "item.bread": { word: "" } } }))("es")).toBeNull();
    expect(await seededLabelsReader(async () => ({ exists: false, data: undefined }))("es")).toBeNull();
    expect(await seededLabelsReader(async () => Promise.reject(new Error("offline")))("es")).toBeNull();
    expect(await seededLabelsReader(async () => ({ exists: true, data: { "item.bread": { word: "pan" } } }))("es")).toEqual({ "item.bread": { word: "pan" } });
  });
});

describe("LabelChip (hover label: word, reading, audio, save)", () => {
  const clip: TtsClip = { mime: "audio/wav", data: new ArrayBuffer(100), durationMs: 400 };

  it("shows the English word until the label loads, then plays and saves on click", async () => {
    setLabelLoader(async () => ({ labels: { "prop.bench": { word: "ベンチ", reading: "benchi" } }, complete: false }));
    labelStore.setState({ byLang: {}, status: {} });
    const tts: TtsSpeaker & { clip: ReturnType<typeof vi.fn> } = { clip: vi.fn(async () => ({ ok: true as const, clip, source: "seeded" as const, hash: "h" })) };
    const player: VoicePlayer & { play: ReturnType<typeof vi.fn> } = { play: vi.fn(async () => {}), stop: vi.fn() };
    const saved: unknown[] = [];
    const off = onSaveWord((d) => saved.push(d));
    render(<LabelChip lang="ja" labelKey="prop.bench" tts={tts} player={player} />);
    await act(async () => {});
    expect(screen.getByText("ベンチ")).toBeTruthy();
    expect(screen.getByText("benchi")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("ベンチ"));
    });
    expect(tts.clip).toHaveBeenCalledWith(expect.objectContaining({ npcId: "librarian", lang: "ja", text: "ベンチ", seeded: true }));
    expect(player.play).toHaveBeenCalledWith(clip, 1);
    expect(saved).toEqual([{ lang: "ja", surface: "ベンチ", reading: "benchi", example: "ベンチ", source: "object:prop.bench" }]);
    off();
  });

  it("falls back to the English word when no label could be made", async () => {
    setLabelLoader(async () => ({ labels: {}, complete: false }));
    labelStore.setState({ byLang: {}, status: {} });
    requestLabels("fr");
    render(<LabelChip lang="fr" labelKey="item.bread" />);
    await act(async () => {});
    expect(screen.getByText("bread")).toBeTruthy();
  });
});

describe("chat words", () => {
  it("splits spaced and unspaced scripts into clickable words", () => {
    expect(chatPieces("¡Hola, Lia!", "es").filter((p) => p.word).map((p) => p.text)).toEqual(["Hola", "Lia"]);
    expect(chatPieces("パンを買いたい", "ja").filter((p) => p.word).length).toBeGreaterThan(1);
    expect(chatPieces("a b", "es").map((p) => p.text).join("")).toBe("a b");
  });
});
