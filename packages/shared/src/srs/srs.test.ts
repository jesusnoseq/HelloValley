import { describe, expect, it } from "vitest";
import { NotebookEntrySchema } from "../firestore/schemas";
import { saveWordDraft } from "../language/layout";
import { npcContextFixture } from "../npc/fixtures";
import { buildNpcTurnVariables } from "../npc/prompt";
import {
  buildReviewQueue,
  CardState,
  cardOf,
  currentStreak,
  DAY_MS,
  FSRS_LEARNING_STEPS_MIN,
  FsrsCardSchema,
  initDifficulty,
  initStability,
  isPlausibleLocalDay,
  KNOWN_STABILITY_DAYS,
  localDayNumber,
  newCard,
  nextIntervalDays,
  nextStreak,
  notebookEntryFromDraft,
  notebookEntryId,
  type NotebookItem,
  notebookStats,
  pickLearningWords,
  previewReview,
  Rating,
  retrievability,
  reviewCard,
  REVIEW_NEW_PER_SESSION,
  REVIEW_SESSION_MAX,
  wordStatus,
  wordTtsLine,
  wordVoiceNpc,
} from "./index";

const T0 = Date.UTC(2026, 10, 1, 9, 0, 0);
const MIN = 60_000;

describe("FSRS-5 core formulas", () => {
  it("recall is 90 % after `stability` days, and the interval at 90 % retention is the stability", () => {
    expect(retrievability(0, 5)).toBe(1);
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 10);
    expect(retrievability(50, 5)).toBeLessThan(0.6);
    expect(nextIntervalDays(10)).toBe(10);
    expect(nextIntervalDays(0.01)).toBe(1);
    expect(nextIntervalDays(1e9)).toBe(36_500);
  });

  it("starts stability and difficulty from the first rating (default weights)", () => {
    expect(initStability(Rating.Again)).toBeCloseTo(0.40255, 5);
    expect(initStability(Rating.Easy)).toBeCloseTo(15.69105, 5);
    expect(initDifficulty(Rating.Again)).toBeGreaterThan(initDifficulty(Rating.Good));
    expect(initDifficulty(Rating.Good)).toBeGreaterThan(initDifficulty(Rating.Easy));
    for (const g of [1, 2, 3, 4] as const) {
      expect(initDifficulty(g)).toBeGreaterThanOrEqual(1);
      expect(initDifficulty(g)).toBeLessThanOrEqual(10);
    }
  });
});

describe("FSRS scheduler", () => {
  it("sends a new card through learning steps, Easy graduates at once", () => {
    const p = previewReview(newCard(T0), T0);
    expect(p[Rating.Again]).toMatchObject({ state: CardState.Learning, due: T0 + FSRS_LEARNING_STEPS_MIN.again * MIN, reps: 1 });
    expect(p[Rating.Hard].due).toBe(T0 + 5 * MIN);
    expect(p[Rating.Good]).toMatchObject({ state: CardState.Learning, due: T0 + 10 * MIN });
    expect(p[Rating.Easy]).toMatchObject({ state: CardState.Review, scheduledDays: 16 });
    for (const card of Object.values(p)) expect(FsrsCardSchema.safeParse(card).success).toBe(true);
  });

  it("graduates a learning card with Good, and orders Good < Easy", () => {
    const learning = reviewCard(newCard(T0), Rating.Good, T0);
    const p = previewReview(learning, T0 + 10 * MIN);
    expect(p[Rating.Again].state).toBe(CardState.Learning);
    expect(p[Rating.Good].state).toBe(CardState.Review);
    expect(p[Rating.Good].scheduledDays).toBeGreaterThanOrEqual(1);
    expect(p[Rating.Easy].scheduledDays).toBeGreaterThan(p[Rating.Good].scheduledDays);
  });

  it("grows intervals on successful reviews and keeps Hard ≤ Good < Easy", () => {
    let card = reviewCard(reviewCard(newCard(T0), Rating.Good, T0), Rating.Good, T0 + 10 * MIN);
    let now = card.due;
    const intervals: number[] = [card.scheduledDays];
    for (let i = 0; i < 4; i++) {
      const p = previewReview(card, now);
      expect(p[Rating.Hard].scheduledDays).toBeLessThanOrEqual(p[Rating.Good].scheduledDays);
      expect(p[Rating.Good].scheduledDays).toBeLessThan(p[Rating.Easy].scheduledDays);
      card = p[Rating.Good];
      intervals.push(card.scheduledDays);
      now = card.due;
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]!).toBeGreaterThan(intervals[i - 1]!);
    expect(card.stability).toBeGreaterThan(KNOWN_STABILITY_DAYS);
    expect(wordStatus(card)).toBe("known");
  });

  it("a lapse relearns, counts the lapse and lowers stability", () => {
    const review = { ...newCard(T0), state: CardState.Review, stability: 30, difficulty: 5, reps: 5, lastReview: T0, due: T0 + 30 * DAY_MS, scheduledDays: 30 } as const;
    const now = T0 + 30 * DAY_MS;
    const forgot = reviewCard(review, Rating.Again, now);
    expect(forgot).toMatchObject({ state: CardState.Relearning, lapses: 1, due: now + 5 * MIN });
    expect(forgot.stability).toBeLessThan(review.stability);
    expect(forgot.difficulty).toBeGreaterThan(review.difficulty);
    const back = reviewCard(forgot, Rating.Good, now + 5 * MIN);
    expect(back.state).toBe(CardState.Review);
  });

  it("is deterministic (no fuzz)", () => {
    const a = reviewCard(newCard(T0), Rating.Easy, T0);
    const b = reviewCard(newCard(T0), Rating.Easy, T0);
    expect(a).toEqual(b);
  });
});

const draft = (surface: string, i = 0) => ({ lang: "es", surface, gloss: `g${i}`, example: `Quiero ${surface}.`, source: "npc:baker" });

function saveTen(): NotebookItem[] {
  const words = ["pan", "leche", "harina", "azúcar", "mantequilla", "café", "queso", "manzana", "huevo", "miel"];
  return words.map((w, i) => {
    const entry = notebookEntryFromDraft(draft(w, i))!;
    return { id: notebookEntryId(entry), entry, createdMs: T0 + i * 1000 };
  });
}

describe("notebook entries", () => {
  it("keys one entry per lemma (case and spacing do not matter)", () => {
    expect(notebookEntryId({ surface: "Pan" })).toBe(notebookEntryId({ surface: " pan " }));
    expect(notebookEntryId({ surface: "panes", lemma: "pan" })).toBe(notebookEntryId({ surface: "pan" }));
    expect(notebookEntryId({ surface: "pan" })).not.toBe(notebookEntryId({ surface: "leche" }));
    expect(notebookEntryId({ surface: "パン" })).toMatch(/^w_[0-9a-f]{16}$/);
  });

  it("builds a valid entry from a bubble click, chat or a world label", () => {
    const line = { tokens: [{ surface: "Hola", lemma: "hola", gloss: "hello", pos: "interj" as const }], translation: "Hello" };
    const fromBubble = notebookEntryFromDraft(saveWordDraft(line, 0, "es", "Latn", "npc:baker")!, "a".repeat(64))!;
    expect(fromBubble).toMatchObject({ surface: "Hola", lemma: "hola", gloss: "hello", source: "npc:baker", audioHash: "a".repeat(64) });
    expect(NotebookEntrySchema.safeParse({ ...fromBubble, createdAt: { seconds: 1, nanoseconds: 0 } }).success).toBe(true);
    expect(notebookEntryFromDraft({ lang: "es", surface: "banco", example: "banco", source: "object:prop.bench" })).toEqual({ surface: "banco", source: "object:prop.bench" });
    expect(notebookEntryFromDraft({ lang: "es", surface: "hola", example: "¡hola a todos!", source: "chat" })?.example).toBe("¡hola a todos!");
    expect(notebookEntryFromDraft({ lang: "es", surface: "  ", example: "", source: "chat" })).toBeNull();
    expect(notebookEntryFromDraft({ lang: "es", surface: "x", example: "", source: "evil" })).toBeNull();
    expect(notebookEntryFromDraft({ lang: "es", surface: "x".repeat(300), example: "y".repeat(900), source: "chat" })).toMatchObject({ surface: "x".repeat(200) });
  });

  it("a stored card parses with the entry schema", () => {
    const card = reviewCard(newCard(T0), Rating.Good, T0);
    expect(NotebookEntrySchema.safeParse({ surface: "pan", source: "chat", fsrs: card, createdAt: { seconds: 1, nanoseconds: 0 } }).success).toBe(true);
    expect(NotebookEntrySchema.safeParse({ surface: "pan", source: "chat", fsrs: { due: "soon" }, createdAt: { seconds: 1, nanoseconds: 0 } }).success).toBe(false);
  });
});

describe("review sessions, learning words and stats (build plan M25 acceptance)", () => {
  it("save 10 words, review them, and the NPC prompt includes a learning word", () => {
    let items = saveTen();
    expect(notebookStats(items, T0 + DAY_MS)).toMatchObject({ total: 10, new: 10, learning: 0, known: 0, due: 10, bySource: { "npc:baker": 10 } });

    // One session: every new word comes up once; Good on all but one Again.
    const now = T0 + 60 * MIN;
    const queue = buildReviewQueue(items, now);
    expect(queue).toHaveLength(10);
    items = items.map((it) => {
      const rating = it.entry.surface === "harina" ? Rating.Again : Rating.Good;
      return { ...it, entry: { ...it.entry, fsrs: reviewCard(cardOf(it), rating, now) } };
    });
    const stats = notebookStats(items, now);
    expect(stats).toMatchObject({ new: 0, learning: 10, known: 0 });

    const words = pickLearningWords(items, now + 2 * MIN);
    expect(words).toHaveLength(5);
    // The weakest card (rated Again, already due again) comes first.
    expect(words[0]).toBe("harina");

    const vars = buildNpcTurnVariables({ ...npcContextFixture({ lang: "es", playerLevel: "A1" }), learningWords: words }, { name: "Lia", animal: "fox", apartmentId: "3B" });
    const inPrompt = JSON.parse(String(vars.learning_words)) as string[];
    expect(inPrompt).toContain("harina");
    expect(inPrompt.every((w) => words.includes(w))).toBe(true);
  });

  it("queues due cards first, then new ones, at most 15", () => {
    const many: NotebookItem[] = Array.from({ length: 30 }, (_, i) => {
      const entry = notebookEntryFromDraft(draft(`palabra${i}`))!;
      const reviewed = i < 8 ? { fsrs: { ...reviewCard(newCard(T0), Rating.Good, T0), due: T0 + i * MIN } } : {};
      return { id: notebookEntryId(entry), entry: { ...entry, ...reviewed }, createdMs: T0 + i };
    });
    const q = buildReviewQueue(many, T0 + DAY_MS);
    expect(q).toHaveLength(REVIEW_SESSION_MAX);
    expect(q.slice(0, 8).map((x) => x.entry.surface)).toEqual(Array.from({ length: 8 }, (_, i) => `palabra${i}`));
    expect(q.slice(8).every((x) => wordStatus(x.entry.fsrs) === "new")).toBe(true);
    // Nothing reviewed is due yet: only new cards, up to the per-session cap.
    expect(buildReviewQueue(many, T0 - 1)).toHaveLength(REVIEW_NEW_PER_SESSION);
  });

  it("leaves known words out of NPC prompts and fills with new words", () => {
    const [a, b, c] = saveTen();
    const known = { ...a!, entry: { ...a!.entry, fsrs: { ...newCard(T0), state: CardState.Review, stability: 60, reps: 6, lastReview: T0, due: T0 + 60 * DAY_MS, scheduledDays: 60 } } };
    const learning = { ...b!, entry: { ...b!.entry, fsrs: reviewCard(newCard(T0), Rating.Good, T0) } };
    expect(pickLearningWords([known, learning, c!], T0)).toEqual(["leche", "harina"]);
    expect(pickLearningWords([], T0)).toEqual([]);
  });
});

describe("review streak", () => {
  it("counts consecutive local days and restarts after a gap", () => {
    let s = { streak: 0, day: null as number | null };
    s = nextStreak(s, 100);
    expect(s).toMatchObject({ streak: 1, day: 100, changed: true });
    expect(nextStreak(s, 100)).toMatchObject({ streak: 1, changed: false });
    s = nextStreak(s, 101);
    expect(s.streak).toBe(2);
    expect(nextStreak(s, 99)).toMatchObject({ streak: 2, day: 101, changed: false });
    expect(nextStreak(s, 104)).toMatchObject({ streak: 1, day: 104 });
    expect(currentStreak(s, 102)).toBe(2);
    expect(currentStreak(s, 103)).toBe(0);
    expect(currentStreak({ streak: 0, day: null }, 5)).toBe(0);
  });

  it("uses the player's local day, within a day of UTC", () => {
    const utc = Date.UTC(2026, 10, 1, 23, 30);
    // UTC+2 (getTimezoneOffset −120) is already the next day.
    expect(localDayNumber(utc, -120)).toBe(localDayNumber(utc, 0) + 1);
    expect(isPlausibleLocalDay(localDayNumber(utc, -120), utc)).toBe(true);
    expect(isPlausibleLocalDay(localDayNumber(utc, 0) + 3, utc)).toBe(false);
    expect(isPlausibleLocalDay(1.5, utc)).toBe(false);
  });
});

describe("word audio", () => {
  it("voices a word in its villager's voice, else the Librarian's, at A1 pace", () => {
    expect(wordVoiceNpc("npc:baker")).toBe("baker");
    expect(wordVoiceNpc("npc:ghost")).toBe("librarian");
    expect(wordVoiceNpc("object:prop.bench")).toBe("librarian");
    expect(wordVoiceNpc("chat")).toBe("librarian");
    expect(wordTtsLine({ surface: "pan", source: "npc:farmer" }, "es")).toEqual({ npcId: "farmer", lang: "es", level: "A1", text: "pan" });
  });
});
