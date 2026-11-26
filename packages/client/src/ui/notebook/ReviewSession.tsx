import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildReviewQueue,
  cardOf,
  type FsrsCard,
  type NotebookItem,
  previewReview,
  Rating,
  RATINGS,
  REVIEW_REPEATS_MAX,
  TTS_SLOW_RATE,
  wordTtsLine,
} from "@hellovalley/shared";
import { lazyTts } from "../../ai/client";
import type { TtsClip, TtsSpeaker } from "../../ai/tts";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import type { Notebook } from "../../notebook/notebook";
import { type VoicePlayer, voicePlayer } from "../speech/voicePlayer";
import { sourceName } from "./sourceName";

const RATING_KEYS: Record<Rating, MessageKey> = {
  [Rating.Again]: "notebook.rate.again",
  [Rating.Hard]: "notebook.rate.hard",
  [Rating.Good]: "notebook.rate.good",
  [Rating.Easy]: "notebook.rate.easy",
};

/** "10 min", "3 d", "2 mo" until the card is due again. */
export function intervalText(card: FsrsCard, nowMs: number, t: (k: MessageKey, p?: Record<string, string>) => string): string {
  if (card.scheduledDays === 0) return t("notebook.interval.minutes", { n: String(Math.max(1, Math.round((card.due - nowMs) / 60_000))) });
  if (card.scheduledDays < 31) return t("notebook.interval.days", { n: String(card.scheduledDays) });
  if (card.scheduledDays < 365) return t("notebook.interval.months", { n: String(Math.round(card.scheduledDays / 30)) });
  return t("notebook.interval.years", { n: String(Math.round(card.scheduledDays / 365)) });
}

export interface ReviewSessionProps {
  notebook: Notebook;
  items: readonly NotebookItem[];
  lang: string;
  onClose: () => void;
  tts?: TtsSpeaker;
  player?: VoicePlayer;
  now?: () => number;
}

/**
 * The daily review (GDD §6.3, build plan M25): 5–15 cards (`buildReviewQueue`: due cards, then new
 * ones). Each card goes listen → recall → rate: the word plays in its villager's voice (or the
 * Librarian's) and shows with its reading; the player recalls the meaning, reveals it (Space or
 * "Show meaning": gloss and example sentence) and rates Again / Hard / Good / Easy (keys 1–4,
 * each with the time until the card comes back). Again sends the card to the end of the session
 * (at most twice). The end of the session counts the day for the streak.
 */
export function ReviewSession({ notebook, items, lang, onClose, tts = lazyTts, player = voicePlayer(), now = Date.now }: ReviewSessionProps) {
  const { t } = useI18n();
  // The queue is fixed when the session starts; cards are looked up live (their FSRS state changes).
  const [queue, setQueue] = useState<string[]>(() => buildReviewQueue(items, now()).map((i) => i.id));
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  // The clip answer is kept with the card it belongs to, so a new card reads as loading at once.
  const [clipAnswer, setClipAnswer] = useState<{ id: string; clip: TtsClip | "none" } | null>(null);
  const repeats = useRef(new Map<string, number>());
  const finished = useRef(false);
  const revealButton = useRef<HTMLButtonElement>(null);
  const firstRate = useRef<HTMLButtonElement>(null);

  const id = queue[index];
  const item = id ? items.find((i) => i.id === id) : undefined;
  const done = !item;
  const clip: TtsClip | "none" | null = item && clipAnswer?.id === item.id ? clipAnswer.clip : null;
  const preview = useMemo(() => (item ? previewReview(cardOf(item), now()) : null), [item, now]);

  // Listen: the word's clip, played once when it arrives.
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    const cardId = item.id;
    void tts.clip(wordTtsLine(item.entry, lang)).then((r) => {
      if (cancelled) return;
      setClipAnswer({ id: cardId, clip: r.ok ? r.clip : "none" });
      if (r.ok) player.play(r.clip, 1).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [item?.id, lang, tts, player]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (revealed ? firstRate : revealButton).current?.focus();
  }, [revealed, index]);

  useEffect(() => {
    if (done && reviewed > 0 && !finished.current) {
      finished.current = true;
      void notebook.finishSession(reviewed);
    }
  }, [done, reviewed, notebook]);

  const rate = async (rating: Rating) => {
    if (!item) return;
    await notebook.rate(item.id, rating);
    setReviewed((n) => n + 1);
    if (rating === Rating.Again) {
      const n = repeats.current.get(item.id) ?? 0;
      if (n < REVIEW_REPEATS_MAX) {
        repeats.current.set(item.id, n + 1);
        setQueue((q) => [...q, item.id]);
      }
    }
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (done) return;
    if (!revealed && (e.key === " " || e.key === "Enter") && e.target === e.currentTarget) {
      e.preventDefault();
      setRevealed(true);
      return;
    }
    const n = Number(e.key);
    if (revealed && n >= 1 && n <= 4) {
      e.preventDefault();
      void rate(n as Rating);
    }
  };

  if (queue.length === 0) {
    return (
      <div className="hv-review" role="region" aria-label={t("notebook.review.title")} onKeyDown={onKeyDown}>
        <p>{t("notebook.review.nothing")}</p>
        <button type="button" onClick={onClose}>
          {t("notebook.review.back")}
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="hv-review" role="region" aria-label={t("notebook.review.title")} onKeyDown={onKeyDown}>
        <p role="status">{t("notebook.review.done", { n: String(reviewed) })}</p>
        <button type="button" autoFocus onClick={onClose}>
          {t("notebook.review.back")}
        </button>
      </div>
    );
  }

  const { entry } = item;
  return (
    <div className="hv-review" role="region" aria-label={t("notebook.review.title")} tabIndex={-1} onKeyDown={onKeyDown}>
      <p className="hv-review__progress">{t("notebook.review.progress", { n: String(index + 1), total: String(queue.length) })}</p>
      <div className="hv-review__card">
        <p className="hv-review__word" lang={lang}>
          {entry.surface}
          {entry.reading ? <span className="hv-review__reading">{entry.reading}</span> : null}
        </p>
        <p className="hv-review__audio">
          {clip === null ? (
            <span role="status" aria-label={t("speech.audio.loading")}>
              …
            </span>
          ) : clip === "none" ? (
            <span role="img" aria-label={t("speech.audio.unavailable")}>
              🔇
            </span>
          ) : (
            <>
              <button type="button" aria-label={t("speech.audio.replay")} onClick={() => player.play(clip, 1).catch(() => undefined)}>
                🔁
              </button>
              <button type="button" aria-label={t("speech.audio.slow")} onClick={() => player.play(clip, TTS_SLOW_RATE).catch(() => undefined)}>
                🐢
              </button>
            </>
          )}
        </p>
        {revealed ? (
          <div className="hv-review__back">
            <p className="hv-review__gloss">{entry.gloss ?? t("notebook.noGloss")}</p>
            {entry.example ? (
              <p className="hv-review__example" lang={lang}>
                “{entry.example}”
              </p>
            ) : null}
            <p className="hv-review__source">{sourceName(entry.source, t)}</p>
          </div>
        ) : (
          <p className="hv-review__prompt">{t("notebook.review.recall")}</p>
        )}
      </div>
      {revealed && preview ? (
        <div className="hv-review__rates" role="group" aria-label={t("notebook.review.rate")}>
          {RATINGS.map((r, i) => (
            <button key={r} ref={i === 0 ? firstRate : undefined} type="button" aria-keyshortcuts={String(r)} onClick={() => void rate(r)}>
              <kbd>{r}</kbd> {t(RATING_KEYS[r])}
              <span className="hv-review__interval">{intervalText(preview[r], now(), t)}</span>
            </button>
          ))}
        </div>
      ) : (
        <button ref={revealButton} type="button" className="hv-review__reveal" aria-keyshortcuts="Space" onClick={() => setRevealed(true)}>
          {t("notebook.review.show")} <kbd>Space</kbd>
        </button>
      )}
    </div>
  );
}
