import { type CSSProperties, useEffect } from "react";
import { type AiStatus, clearJustReady, useAiStatus } from "../ai/availability";
import type { MessageKey } from "../i18n/i18n";
import { useI18n } from "../i18n/I18nProvider";

/** How long the "ready" message stays (ms, my number). */
export const AI_READY_CHIP_MS = 5000;

const chip: CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 30,
  maxWidth: "min(360px, calc(100vw - 24px))",
  padding: "6px 12px",
  borderRadius: 999,
  background: "rgba(255, 250, 240, 0.95)",
  color: "#3d3a44",
  font: "13px/1.35 system-ui, sans-serif",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
  pointerEvents: "none",
};

/** What the chip says for a status, or null when it is hidden. */
export function aiChipMessage(s: AiStatus): { key: MessageKey; percent?: number } | null {
  if (s.onDevice === "downloading") {
    return s.progress === null ? { key: "ai.chip.downloading" } : { key: "ai.chip.progress", percent: Math.round(s.progress * 100) };
  }
  if (s.justReady) return { key: "ai.chip.ready" };
  return null;
}

/**
 * The on-device model status chip (GDD §9.2 warm-up, architecture §5.2): "✨ Speeding up
 * translations…" with the download progress, then a short "ready" note. Hidden otherwise: a
 * browser without on-device AI still gets cloud translations, so there is nothing to say.
 */
export function AiStatusChip() {
  const { t } = useI18n();
  const status = useAiStatus((s) => s);
  const message = aiChipMessage(status);
  useEffect(() => {
    if (!status.justReady) return;
    const timer = setTimeout(clearJustReady, AI_READY_CHIP_MS);
    return () => clearTimeout(timer);
  }, [status.justReady]);
  if (!message) return null;
  return (
    <div style={chip} role="status" aria-live="polite">
      {message.percent === undefined ? t(message.key) : t(message.key, { percent: String(message.percent) })}
    </div>
  );
}
