// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CardState,
  type FsrsCard,
  type NotebookEntryDraft,
  notebookEntryId,
  type NotebookItem,
  pickLearningWords,
  type StreakState,
  ttsKeyMaterial,
} from "@hellovalley/shared";
import type { TtsClip, TtsSpeaker } from "../ai/tts";
import { createNotebookStore } from "../state/notebookStore";
import { NotebookLayer } from "../ui/notebook/NotebookLayer";
import { emitSaveWord, onSaveWord } from "../ui/speech/wordEvents";
import type { VoicePlayer } from "../ui/speech/voicePlayer";
import { createNotebook, type NotebookRepo } from "./notebook";

/**
 * Build plan M25 on the client: words saved from bubbles, chat and labels become notebook entries
 * (one per lemma, with example, audio hash and source), review sessions rate them with FSRS, the
 * finished session reports the streak, and the learning words are what the server passes to NPCs.
 */

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const WORDS = ["pan", "leche", "harina", "azúcar", "mantequilla", "café", "queso", "manzana", "huevo", "miel"];

function memoryRepo() {
  const docs = new Map<string, { entry: NotebookEntryDraft; createdMs: number }>();
  const listeners = new Set<(items: NotebookItem[]) => void>();
  let clock = T0;
  const emit = () => {
    const items = [...docs.entries()].map(([id, d]) => ({ id, entry: d.entry, createdMs: d.createdMs })).sort((a, b) => b.createdMs - a.createdMs);
    for (const l of listeners) l(items);
  };
  const repo: NotebookRepo & { docs: typeof docs; cards: FsrsCard[] } = {
    docs,
    cards: [],
    subscribe(_lang, onItems) {
      listeners.add(onItems);
      queueMicrotask(emit);
      return () => listeners.delete(onItems);
    },
    async create(_lang, id, entry) {
      docs.set(id, { entry, createdMs: clock++ });
      emit();
    },
    async updateCard(_lang, id, card) {
      const d = docs.get(id)!;
      d.entry = { ...d.entry, fsrs: card };
      repo.cards.push(card);
      emit();
    },
    async readStreak(): Promise<StreakState> {
      return { streak: 2, day: null };
    },
  };
  return repo;
}

const clip: TtsClip = { mime: "audio/wav", data: new ArrayBuffer(100), durationMs: 500 };
const fakeTts = (): TtsSpeaker & { clip: ReturnType<typeof vi.fn> } => ({ clip: vi.fn(async () => ({ ok: true as const, clip, source: "memory" as const, hash: "h" })) });
const fakePlayer = (): VoicePlayer & { play: ReturnType<typeof vi.fn> } => ({ play: vi.fn(async () => {}), stop: vi.fn() });

function setup() {
  const repo = memoryRepo();
  const store = createNotebookStore();
  const reportReview = vi.fn(async (_lang: string, day: number) => ({ streak: 3, day }));
  const audioHash = vi.fn(async (line: Parameters<typeof ttsKeyMaterial>[0]) => (ttsKeyMaterial(line).length > 0 ? "a".repeat(64) : null));
  const gloss = vi.fn(async (surface: string) => `en:${surface}`);
  let now = T0;
  const notebook = createNotebook({ repo, store, audioHash, gloss, reportReview, now: () => now, timezoneOffsetMin: () => 0 });
  return { repo, store, notebook, reportReview, audioHash, gloss, advance: (ms: number) => (now += ms), now: () => now };
}

afterEach(cleanup);

describe("notebook service", () => {
  it("saves words from bubbles, chat and labels once each, with audio and source", async () => {
    const { repo, store, notebook, audioHash, gloss } = setup();
    notebook.start("es", "en");
    await act(async () => {});
    expect(store.getState().status).toBe("ready");
    expect(store.getState().streak.streak).toBe(2);

    expect(await notebook.save({ lang: "es", surface: "Pan", lemma: "pan", gloss: "bread", example: "¿Quieres pan?", source: "npc:baker" })).toBe("saved");
    expect(await notebook.save({ lang: "es", surface: "pan", example: "pan pan", source: "chat" })).toBe("exists");
    expect(await notebook.save({ lang: "es", surface: "banco", example: "banco", source: "object:prop.bench" })).toBe("saved");
    expect(await notebook.save({ lang: "ja", surface: "パン", example: "パン", source: "chat" })).toBe("off");

    expect(repo.docs.size).toBe(2);
    const pan = repo.docs.get(notebookEntryId({ surface: "pan" }))!.entry;
    expect(pan).toMatchObject({ surface: "Pan", lemma: "pan", gloss: "bread", example: "¿Quieres pan?", source: "npc:baker", audioHash: "a".repeat(64) });
    // The word is voiced by the villager it came from; labels by the Librarian.
    expect(audioHash.mock.calls[0]![0]).toMatchObject({ npcId: "baker", lang: "es", level: "A1", text: "Pan" });
    expect(audioHash.mock.calls[1]![0]).toMatchObject({ npcId: "librarian", text: "banco" });
    // Saved without a gloss: the native-language one is filled in.
    expect(repo.docs.get(notebookEntryId({ surface: "banco" }))!.entry.gloss).toBe("en:banco");
    expect(gloss).toHaveBeenCalledTimes(1);
    expect(store.getState().lastSave).toMatchObject({ surface: "banco", outcome: "saved" });
  });

  it("listens to the word events the bubbles, chat and labels emit", async () => {
    const { repo, notebook } = setup();
    notebook.start("es", "en");
    const off = onSaveWord((d) => void notebook.save(d));
    emitSaveWord({ lang: "es", surface: "hola", example: "hola a todos", source: "chat" });
    await vi.waitFor(() => expect(repo.docs.size).toBe(1));
    off();
  });
});

describe("review session (build plan M25 acceptance: save 10 words, review them, learning words for NPCs)", () => {
  it("reviews 10 saved words by keyboard: listen → recall → rate, then counts the streak", async () => {
    const { repo, store, notebook, reportReview, now } = setup();
    notebook.start("es", "en");
    await act(async () => {});
    for (const [i, w] of WORDS.entries()) {
      await act(async () => void (await notebook.save({ lang: "es", surface: w, gloss: `g${i}`, example: `Quiero ${w}.`, source: "npc:baker" })));
    }
    expect(store.getState().items).toHaveLength(10);

    const tts = fakeTts();
    const player = fakePlayer();
    render(<NotebookLayer notebook={() => notebook} store={store} tts={tts} player={player} now={now} />);
    // N opens the notebook; it shows 10 new words.
    fireEvent.keyDown(window, { code: "KeyN" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Review 10 words")).toBeTruthy();
    fireEvent.click(screen.getByText("Review 10 words"));

    for (let i = 0; i < 10; i++) {
      const region = screen.getByRole("region");
      await act(async () => {});
      expect(screen.getByText(`Card ${i + 1} of ${i === 0 ? 10 : 11}`)).toBeTruthy();
      // Listen: the word plays (and shows), the meaning is hidden.
      expect(screen.queryByText(/^g\d$/)).toBeNull();
      // Recall, then reveal with Space on the session.
      fireEvent.keyDown(region, { key: " " });
      expect(screen.getByText(/^g\d$/)).toBeTruthy();
      // Rate: 3 = Good (the first card: 1 = Again, it comes back once more at the end).
      await act(async () => {
        fireEvent.keyDown(region, { key: i === 0 ? "1" : "3" });
      });
    }
    // The Again card comes back once.
    fireEvent.keyDown(screen.getByRole("region"), { key: " " });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("region"), { key: "3" });
    });
    expect(screen.getByText(/You reviewed 11 cards/)).toBeTruthy();
    expect(tts.clip).toHaveBeenCalled();
    expect(tts.clip.mock.calls[0]![0]).toMatchObject({ npcId: "baker", lang: "es", level: "A1" });
    expect(player.play).toHaveBeenCalled();
    await vi.waitFor(() => expect(reportReview).toHaveBeenCalledWith("es", Math.floor(T0 / 86_400_000)));
    expect(store.getState().streak.streak).toBe(3);

    // Every word now has a card in learning, saved to Firestore through the repo.
    expect(repo.cards).toHaveLength(11);
    for (const item of store.getState().items) expect(item.entry.fsrs?.state).not.toBe(CardState.New);
    // …and the NPC prompt gets up to 5 of them (the server runs the same pick on the notebook).
    const words = pickLearningWords(store.getState().items, now());
    expect(words).toHaveLength(5);
    for (const w of words) expect(WORDS).toContain(w);
  });

  it("shows the stats: known, learning, new and the words by source", async () => {
    const { store, notebook, now } = setup();
    notebook.start("es", "en");
    await act(async () => {});
    await act(async () => void (await notebook.save({ lang: "es", surface: "pan", example: "pan", source: "npc:baker" })));
    await act(async () => void (await notebook.save({ lang: "es", surface: "banco", example: "banco", source: "object:prop.bench" })));
    store.setState({ open: true });
    render(<NotebookLayer notebook={() => notebook} store={store} tts={fakeTts()} player={fakePlayer()} now={now} />);
    expect(screen.getByText("New").nextSibling?.textContent).toBe("2");
    expect(screen.getByText(/From the Baker: 1/)).toBeTruthy();
    expect(screen.getByText(/From an object \(bench\): 1/)).toBeTruthy();
  });
});
