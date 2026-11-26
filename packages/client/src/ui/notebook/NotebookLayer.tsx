import { useEffect, useMemo, useRef, useState } from "react";
import { currentStreak, localDayNumber, type NotebookItem, notebookStats, REVIEW_SESSION_MAX, wordStatus, wordTtsLine } from "@hellovalley/shared";
import { lazyTts } from "../../ai/client";
import type { TtsSpeaker } from "../../ai/tts";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import type { Notebook } from "../../notebook/notebook";
import { type NotebookStore, notebookStore, setNotebookOpen, useNotebook } from "../../state/notebookStore";
import { type VoicePlayer, voicePlayer } from "../speech/voicePlayer";
import { ReviewSession } from "./ReviewSession";
import { sourceName } from "./sourceName";
import "./notebook.css";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Entries listed in the panel (newest first; my number). */
export const NOTEBOOK_LIST_MAX = 60;

export interface NotebookLayerProps {
  /** The running notebook; null before it started (the button still opens the panel). */
  notebook: () => Notebook | null;
  store?: NotebookStore;
  tts?: TtsSpeaker;
  player?: VoicePlayer;
  now?: () => number;
}

/**
 * The notebook on screen (build plan M25, GDD §6.3, §10 "N notebook"): a HUD button with the cards
 * due, and a panel with the stats (words known, learning, new, the review streak and the words
 * by source), the saved words (reading, gloss, example, source, audio) and the review session.
 * N (outside a text box) toggles the panel; Escape closes it.
 */
export function NotebookLayer({ notebook, store = notebookStore, tts = lazyTts, player = voicePlayer(), now = Date.now }: NotebookLayerProps) {
  const { t } = useI18n();
  const open = useNotebook((s) => s.open, store);
  const status = useNotebook((s) => s.status, store);
  const items = useNotebook((s) => s.items, store);
  const lang = useNotebook((s) => s.lang, store);
  const streakState = useNotebook((s) => s.streak, store);
  const lastSave = useNotebook((s) => s.lastSave, store);
  const [reviewingState, setReviewing] = useState(false);
  // Closing the notebook ends a review session.
  const reviewing = open && reviewingState;
  const stats = useMemo(() => notebookStats(items, now()), [items, now]);
  const streak = currentStreak(streakState, localDayNumber(now(), new Date(now()).getTimezoneOffset()));
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (e.code === "KeyN") {
        e.preventDefault();
        setReviewing(false);
        setNotebookOpen(!store.getState().open, store);
      } else if (e.code === "Escape" && store.getState().open) {
        e.preventDefault();
        setReviewing(false);
        setNotebookOpen(false, store);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  useEffect(() => {
    if (open && !reviewing) heading.current?.focus();
  }, [open, reviewing]);

  const playWord = (item: NotebookItem) => {
    if (!lang) return;
    void tts.clip(wordTtsLine(item.entry, lang)).then((r) => {
      if (r.ok) player.play(r.clip, 1).catch(() => undefined);
    });
  };

  const recentSave = lastSave && now() - lastSave.at < 4000 ? lastSave : null;
  const nb = notebook();

  return (
    <>
      <button type="button" className="hv-notebook-button" aria-expanded={open} aria-keyshortcuts="N" onClick={() => {
          setReviewing(false);
          setNotebookOpen(!open, store);
        }}>
        📓 {t("notebook.button")}
        {stats.due > 0 ? <span className="hv-notebook-button__due">{t("notebook.due", { n: String(stats.due) })}</span> : null}
      </button>
      {recentSave && (recentSave.outcome === "saved" || recentSave.outcome === "exists" || recentSave.outcome === "failed") ? (
        <p className="hv-notebook-saved" role="status">
          {t(`notebook.saved.${recentSave.outcome}` as MessageKey, { word: recentSave.surface })}
        </p>
      ) : null}
      {open ? (
        <section className="hv-notebook" role="dialog" aria-modal="false" aria-labelledby="hv-notebook-title">
          <header className="hv-notebook__header">
            <h2 id="hv-notebook-title" ref={heading} tabIndex={-1}>
              📓 {t("notebook.title")}
            </h2>
            <button type="button" onClick={() => setNotebookOpen(false, store)} aria-label={t("notebook.close")}>
              ✕
            </button>
          </header>
          <dl className="hv-notebook__stats">
            <div>
              <dt>{t("notebook.stats.known")}</dt>
              <dd>{stats.known}</dd>
            </div>
            <div>
              <dt>{t("notebook.stats.learning")}</dt>
              <dd>{stats.learning}</dd>
            </div>
            <div>
              <dt>{t("notebook.stats.new")}</dt>
              <dd>{stats.new}</dd>
            </div>
            <div>
              <dt>{t("notebook.stats.streak")}</dt>
              <dd>🔥 {streak}</dd>
            </div>
          </dl>
          {Object.keys(stats.bySource).length > 0 ? (
            <p className="hv-notebook__sources">
              {Object.entries(stats.bySource)
                .sort((a, b) => b[1] - a[1])
                .map(([source, n]) => `${sourceName(source, t)}: ${n}`)
                .join(" · ")}
            </p>
          ) : null}
          {reviewing && nb && lang ? (
            <ReviewSession notebook={nb} items={items} lang={lang} onClose={() => setReviewing(false)} tts={tts} player={player} now={now} />
          ) : (
            <>
              <button type="button" className="hv-notebook__review" disabled={!nb || stats.due === 0} onClick={() => setReviewing(true)}>
                {stats.due > 0 ? t("notebook.review.start", { n: String(Math.min(stats.due, REVIEW_SESSION_MAX)) }) : t("notebook.review.none")}
              </button>
              {status === "loading" ? <p role="status">{t("common.loading")}</p> : null}
              {status === "error" ? <p role="alert">{t("notebook.error")}</p> : null}
              {status === "ready" && items.length === 0 ? <p>{t("notebook.empty")}</p> : null}
              <ul className="hv-notebook__list">
                {items.slice(0, NOTEBOOK_LIST_MAX).map((item) => (
                  <li key={item.id}>
                    <button type="button" className="hv-notebook__play" aria-label={t("notebook.play", { word: item.entry.surface })} onClick={() => playWord(item)}>
                      🔊
                    </button>
                    <span className="hv-notebook__word" lang={lang ?? undefined}>
                      {item.entry.surface}
                      {item.entry.reading ? <span className="hv-notebook__reading"> {item.entry.reading}</span> : null}
                    </span>
                    {item.entry.gloss ? <span className="hv-notebook__gloss"> — {item.entry.gloss}</span> : null}
                    <span className={`hv-notebook__status hv-notebook__status--${wordStatus(item.entry.fsrs)}`}>
                      {t(`notebook.status.${wordStatus(item.entry.fsrs)}` as MessageKey)}
                    </span>
                    {item.entry.example ? (
                      <span className="hv-notebook__example" lang={lang ?? undefined}>
                        “{item.entry.example}”
                      </span>
                    ) : null}
                    <span className="hv-notebook__source">{sourceName(item.entry.source, t)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* TODO(no milestone yet, see pending.md M30): the Librarian's "homework" review sessions (GDD §6.3 in-world review). */}
        </section>
      ) : null}
    </>
  );
}
