import {
  cardOf,
  type FsrsCard,
  localDayNumber,
  notebookEntryFromDraft,
  type NotebookEntryDraft,
  notebookEntryId,
  type NotebookItem,
  type Rating,
  reviewCard,
  type SaveWordDraft,
  type StreakState,
  wordTtsLine,
} from "@hellovalley/shared";
import { type NotebookStore, notebookStore as gameStore, type SaveOutcome } from "../state/notebookStore";

/**
 * The notebook service (build plan M25, GDD §6.3, architecture §8.1: the player owns and writes
 * `users/{uid}/langs/{lang}/notebook/{id}`). Words arrive from the speech bubbles, chat lines and
 * world labels as `SaveWordDraft`s (`ui/speech/wordEvents.ts`); each becomes one entry per lemma
 * (`notebookEntryId`) with the example sentence, the source and the content hash of its audio
 * (the TTS key of the word in its villager's voice, or the Librarian's). Words saved without a
 * gloss (chat, labels) get a short translation into the native language when the AI module can
 * make one. Reviews update the entry's FSRS card; a finished session goes to the server, which
 * keeps the streak (`POST /api/review`).
 */

export interface NotebookRepo {
  /** Live entries of a language (newest first). Returns the unsubscribe function. */
  subscribe(lang: string, onItems: (items: NotebookItem[]) => void, onError: (error: unknown) => void): () => void;
  create(lang: string, id: string, entry: NotebookEntryDraft): Promise<void>;
  updateCard(lang: string, id: string, card: FsrsCard): Promise<void>;
  readStreak(lang: string): Promise<StreakState>;
}

export interface NotebookDeps {
  repo: NotebookRepo;
  store?: NotebookStore;
  /** sha256 of the word's TTS key material (null when it cannot be computed). */
  audioHash(line: ReturnType<typeof wordTtsLine>): Promise<string | null>;
  /** A short gloss in the native language for words saved without one; null when unavailable. */
  gloss?(surface: string, lang: string, nativeLang: string): Promise<string | null>;
  /** POST /api/review: the server's streak after counting `day`, or null on failure. */
  reportReview?(lang: string, day: number): Promise<StreakState | null>;
  now?: () => number;
  timezoneOffsetMin?: () => number;
}

export interface Notebook {
  start(lang: string, nativeLang: string): void;
  stop(): void;
  save(draft: SaveWordDraft): Promise<SaveOutcome>;
  rate(id: string, rating: Rating): Promise<FsrsCard | null>;
  /** A review session ended after `reviewed` ratings: count the day for the streak. */
  finishSession(reviewed: number): Promise<void>;
}

/** Longest wait for a gloss before the word is saved without one (ms, my number). */
export const GLOSS_WAIT_MS = 3000;

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

export function createNotebook(deps: NotebookDeps): Notebook {
  const store = deps.store ?? gameStore;
  const now = deps.now ?? Date.now;
  const tz = deps.timezoneOffsetMin ?? (() => new Date().getTimezoneOffset());
  let unsubscribe: (() => void) | null = null;
  /** Entries written locally that the subscription has not delivered yet. */
  const pending = new Map<string, NotebookItem>();
  let generation = 0;

  const setItems = (items: NotebookItem[]) => {
    for (const it of items) pending.delete(it.id);
    store.setState({ items: [...pending.values(), ...items], status: "ready" });
  };

  const report = (id: string, surface: string, outcome: SaveOutcome) => {
    store.setState({ lastSave: { id, surface, outcome, at: now() } });
    return outcome;
  };

  return {
    start(lang, nativeLang) {
      this.stop();
      const gen = ++generation;
      store.setState({ status: "loading", lang, nativeLang, items: [] });
      unsubscribe = deps.repo.subscribe(
        lang,
        (items) => {
          if (gen === generation) setItems(items);
        },
        (error) => {
          console.warn("notebook: could not read", error);
          if (gen === generation) store.setState({ status: "error" });
        },
      );
      void deps.repo.readStreak(lang).then(
        (streak) => {
          if (gen === generation) store.setState({ streak });
        },
        () => undefined,
      );
    },
    stop() {
      generation++;
      unsubscribe?.();
      unsubscribe = null;
      pending.clear();
      store.setState({ status: "off", lang: null, items: [] });
    },
    async save(draft) {
      const { lang, nativeLang, items, status } = store.getState();
      if (status === "off" || !lang || draft.lang !== lang) return "off";
      let entry = notebookEntryFromDraft(draft);
      if (!entry) return "invalid";
      const id = notebookEntryId(entry);
      if (items.some((i) => i.id === id)) return report(id, entry.surface, "exists");
      const line = wordTtsLine(entry, lang);
      const [hash, gloss] = await Promise.all([
        deps.audioHash(line).catch(() => null),
        !entry.gloss && deps.gloss && nativeLang && nativeLang !== lang ? withTimeout(deps.gloss(entry.surface, lang, nativeLang), GLOSS_WAIT_MS, null) : Promise.resolve(null),
      ]);
      entry = notebookEntryFromDraft({ ...draft, ...(gloss && !draft.gloss ? { gloss } : {}) }, hash ?? undefined) ?? entry;
      if (store.getState().lang !== lang) return "off";
      if (store.getState().items.some((i) => i.id === id)) return report(id, entry.surface, "exists");
      const item: NotebookItem = { id, entry, createdMs: now() };
      pending.set(id, item);
      store.setState((s) => ({ items: [item, ...s.items] }));
      try {
        await deps.repo.create(lang, id, entry);
        return report(id, entry.surface, "saved");
      } catch (error) {
        console.warn("notebook: could not save", error);
        pending.delete(id);
        store.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
        return report(id, entry.surface, "failed");
      }
    },
    async rate(id, rating) {
      const { lang, items } = store.getState();
      const item = items.find((i) => i.id === id);
      if (!lang || !item) return null;
      const card = reviewCard(cardOf(item), rating, now());
      store.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, entry: { ...i.entry, fsrs: card } } : i)) }));
      try {
        await deps.repo.updateCard(lang, id, card);
      } catch (error) {
        console.warn("notebook: could not save the review", error);
      }
      return card;
    },
    async finishSession(reviewed) {
      const { lang } = store.getState();
      if (!lang || reviewed <= 0 || !deps.reportReview) return;
      const streak = await deps.reportReview(lang, localDayNumber(now(), tz())).catch(() => null);
      if (streak && store.getState().lang === lang) store.setState({ streak });
    },
  };
}
