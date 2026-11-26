import { type CSSProperties, useEffect, useState } from "react";
import { isSettled, type LoadProgressStore, loadProgress, useLoadProgress } from "../../assets/loadProgress";
import { useI18n } from "../../i18n/I18nProvider";
import { languageDisplayName } from "../../i18n/i18n";
import { TIP_SECONDS, tipFor } from "./tips";

/**
 * The asset preloading screen (build plan M37): covers the scene while the scene chunk, kits and
 * characters load, with a progress bar and cozy tips in the player's target language (and in the
 * UI language under them). It lifts once nothing has loaded for a moment, after `maxMs` at the
 * latest, and offers a Continue button after `skipAfterMs` (WCAG 2.2.1: the player is not held).
 */

/** Quiet time (ms) after the last load before the screen lifts. */
export const LOADING_QUIET_MS = 600;

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "grid",
  placeItems: "center",
  background: "#d6eaf5",
  color: "#3d3a44",
  font: "16px/1.5 system-ui, sans-serif",
  zIndex: 50,
  padding: 16,
};

const card: CSSProperties = {
  maxWidth: 460,
  width: "100%",
  padding: "20px 24px",
  borderRadius: 14,
  background: "rgba(255, 250, 240, 0.96)",
  boxShadow: "0 4px 18px rgba(0, 0, 0, 0.15)",
};

export function LoadingScreen({
  targetLang,
  store = loadProgress,
  maxMs = 25_000,
  skipAfterMs = 8_000,
}: {
  targetLang: string | null;
  store?: LoadProgressStore;
  maxMs?: number;
  skipAfterMs?: number;
}) {
  const { t, locale } = useI18n();
  const started = useLoadProgress((p) => p.started, store);
  const finished = useLoadProgress((p) => p.finished, store);
  const [done, setDone] = useState(false);
  const [canSkip, setCanSkip] = useState(false);
  const [tipIndex, setTipIndex] = useState(() => Math.floor(Math.random() * 1000));

  useEffect(() => {
    if (done) return;
    const begun = performance.now();
    const check = setInterval(() => {
      const at = performance.now();
      if (isSettled(store.getState(), at, LOADING_QUIET_MS) || at - begun >= maxMs) setDone(true);
      if (at - begun >= skipAfterMs) setCanSkip(true);
    }, 200);
    return () => clearInterval(check);
  }, [done, store, maxMs, skipAfterMs]);

  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setTipIndex((i) => i + 1), TIP_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [done]);

  if (done) return null;
  const tip = tipFor(tipIndex, targetLang, locale);
  const total = Math.max(started, 1);
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-labelledby="hv-loading-title" aria-busy="true">
      <div style={card}>
        <h1 id="hv-loading-title" style={{ margin: "0 0 12px", fontSize: 20 }}>
          {t("loading.title")}
        </h1>
        <progress max={total} value={Math.min(finished, total)} aria-label={t("loading.progress", { done: String(finished), total: String(started) })} style={{ width: "100%", height: 12 }} />
        <p style={{ margin: "4px 0 16px", fontSize: 13, opacity: 0.8 }}>{t("loading.progress", { done: String(finished), total: String(started) })}</p>
        <section aria-label={t("loading.tip")} aria-live="polite">
          <p style={{ margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.7 }}>
            {t("loading.tip")}
            {tip.target ? ` · ${t("loading.tipIn", { language: languageDisplayName(tip.target.lang, locale, tip.target.lang) })}` : ""}
          </p>
          {tip.target ? (
            <p lang={tip.target.lang} style={{ margin: "4px 0 0", fontSize: 18 }}>
              {tip.target.text}
            </p>
          ) : null}
          {tip.translation ? (
            <p lang={tip.translation.lang} style={{ margin: "4px 0 0", fontSize: tip.target ? 14 : 18, opacity: tip.target ? 0.8 : 1 }}>
              {tip.translation.text}
            </p>
          ) : null}
        </section>
        {canSkip ? (
          <button type="button" style={{ marginTop: 16 }} onClick={() => setDone(true)}>
            {t("loading.skip")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
