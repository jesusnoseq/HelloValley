import { getLanguage, lineText, type SaveWordDraft } from "@hellovalley/shared";
import { type CSSProperties, useState } from "react";
import { uiLocaleFor } from "../i18n/i18n";
import { I18nProvider } from "../i18n/I18nProvider";
import { SPEECH_FIXTURES } from "../ui/speech/fixtures";
import { SpeechBubble } from "../ui/speech/SpeechBubble";
import { VoiceControls } from "../ui/speech/VoiceControls";

const page: CSSProperties = {
  minHeight: "100vh",
  boxSizing: "border-box",
  padding: 24,
  background: "#e9f0e4",
  color: "#3d3a44",
  font: "14px/1.4 system-ui, sans-serif",
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
  gap: "56px 24px",
  alignItems: "start",
  paddingTop: 48,
};

/**
 * Dev-only speech bubble gallery (`/dev/speech`, build plan M19): one bubble per fixture (EN ES
 * JA ZH KO AR RU HE FA). Hover words and sentences, click words to "save" them (logged below; the
 * notebook is M25), and cycle the script toggle (saved per language in localStorage). Each bubble
 * voices its newest line as the Baker at A1 (M22: 🔁 and 🐢 buttons, or 🔇 without a cloud
 * backend). Not in production builds (see main.tsx).
 */
export function SpeechGallery() {
  const [saved, setSaved] = useState<SaveWordDraft[]>([]);
  const onSave = (draft: SaveWordDraft) => setSaved((s) => [draft, ...s].slice(0, 12));
  return (
    <main style={page}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Speech bubbles (M19)</h1>
      <p style={{ margin: "4px 0 0", opacity: 0.75 }}>
        Hover a word for its tooltip, hover a sentence (or 🌐) for the translation, click a word to save it, and use the
        script button to cycle native / both / romanized.
      </p>
      <div style={grid}>
        {SPEECH_FIXTURES.map((f) => (
          <section key={f.id} aria-label={f.title}>
            <h2 style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600 }}>
              {f.title} · <code>{f.lang}</code>
            </h2>
            {/* The tooltips use the reader's UI language. */}
            <I18nProvider locale={uiLocaleFor(f.nativeLang)}>
              <SpeechBubble
                lines={f.lines}
                lang={f.lang}
                nativeLang={f.nativeLang}
                speaker={f.speaker}
                source="npc:baker"
                onSaveWord={onSave}
                audio={<VoiceControls autoPlay={false} line={{ npcId: "baker", lang: f.lang, level: "A1", text: lineText(f.lines[f.lines.length - 1]!, getLanguage(f.lang)?.script ?? "Latn") }} />}
              />
            </I18nProvider>
          </section>
        ))}
      </div>
      <section aria-label="Saved words" style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 14 }}>Saved words (notebook stub)</h2>
        <pre style={{ font: "12px ui-monospace, monospace", whiteSpace: "pre-wrap" }}>
          {saved.length === 0 ? "Nothing saved yet." : saved.map((d) => JSON.stringify(d)).join("\n")}
        </pre>
      </section>
    </main>
  );
}
