import { useEffect, useId, useState, type ReactNode } from "react";
import {
  effectiveScriptMode,
  fontStack,
  furiganaSegments,
  getLanguage,
  hasScriptToggle,
  isPunctuation,
  japaneseKana,
  linePieces,
  nextScriptMode,
  romanizedPieces,
  type Romanization,
  type SaveWordDraft,
  saveWordDraft,
  SCRIPT_FONTS,
  type ScriptCode,
  type ScriptMode,
  scriptModeLabel,
  type Token,
  type TokenizedLine,
  tokenReadingLine,
  tokenRomanized,
} from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { ensureScriptFont } from "./fontLoader";
import { scriptModeStore, useStoredScriptMode } from "./scriptModeStore";
import { emitSaveWord } from "./wordEvents";
import "./speech.css";

/** Lines a bubble keeps visible (GDD §6.1); the full log is in the conversation panel (M23). */
export const SPEECH_BUBBLE_LINES = 3;

export interface SpeechBubbleProps {
  /** Tokenized lines, oldest first (parsed with TokenizedLineSchema). */
  lines: readonly TokenizedLine[];
  /** The target language the lines are in. */
  lang: string;
  /** The reader's native language (glosses and translations are in it). */
  nativeLang: string;
  /** Notebook source for saved words: `npc:{npcId}`, `object:{labelKey}` or `chat`. */
  source: string;
  speaker?: string;
  maxLines?: number;
  /** Called with each saved word, as well as `wordEvents`. */
  onSaveWord?: (draft: SaveWordDraft) => void;
  /** Font loader (tests replace it). */
  loadFont?: (script: ScriptCode) => Promise<void>;
  /** Voice controls for the newest line (`VoiceControls`, build plan M22), shown in the header. */
  audio?: ReactNode;
}

interface LangInfo {
  lang: string;
  script: ScriptCode;
  romanization: Romanization;
  rtl: boolean;
  /** BCP 47 tag of romanized text (`ja-Latn`). */
  latinTag: string;
}

function langInfo(lang: string): LangInfo {
  const info = getLanguage(lang);
  const primary = lang.split("-")[0] ?? lang;
  return {
    lang,
    script: info?.script ?? "Latn",
    romanization: info?.romanization ?? null,
    rtl: info?.rtl ?? false,
    latinTag: `${primary}-Latn`,
  };
}

/**
 * The speech bubble (GDD §6.1, build plan M19): the last lines of a speaker in the target
 * language, each word hoverable (lemma, reading, native gloss, part of speech) and clickable
 * (saved to the notebook), the sentence translation on hover (or the 🌐 button), and the 3-state
 * script toggle (native / both / romanized) for non-Latin scripts, with furigana over kanji in
 * "both" for Japanese. Arabic, Hebrew and Persian lines are laid out right to left.
 * The `audio` slot holds the replay and 0.75× buttons (M22). The conversation panel (M23) shows it.
 */
export function SpeechBubble({
  lines,
  lang,
  nativeLang,
  source,
  speaker,
  maxLines = SPEECH_BUBBLE_LINES,
  onSaveWord,
  loadFont = ensureScriptFont,
  audio,
}: SpeechBubbleProps) {
  const { t } = useI18n();
  const info = langInfo(lang);
  const mode = effectiveScriptMode(info.romanization, useStoredScriptMode(lang));
  const toggle = hasScriptToggle(info.romanization);

  useEffect(() => {
    void loadFont(info.script);
    if (mode !== "native" && info.script !== "Latn") void loadFont("Latn");
  }, [loadFont, info.script, mode]);

  const first = Math.max(0, lines.length - maxLines);
  const save = (draft: SaveWordDraft) => {
    onSaveWord?.(draft);
    emitSaveWord(draft);
  };
  return (
    <div className="hv-speech" data-script-mode={mode}>
      {speaker || toggle || audio ? (
        <div className="hv-speech__header">
          {speaker ? <span className="hv-speech__speaker">{speaker}</span> : <span />}
          {audio ? <span className="hv-speech__audio">{audio}</span> : null}
          {toggle ? (
            <button
              type="button"
              className="hv-speech__toggle"
              aria-label={t(`speech.script.${mode}` as MessageKey)}
              title={t("speech.script.cycle")}
              onClick={() => scriptModeStore.getState().setMode(lang, nextScriptMode(mode))}
            >
              {scriptModeLabel(mode, SCRIPT_FONTS[info.script].sample)}
            </button>
          ) : null}
        </div>
      ) : null}
      {lines.slice(first).map((line, i) => (
        <SpeechLine key={first + i} line={line} info={info} mode={mode} nativeLang={nativeLang} source={source} onSave={save} />
      ))}
    </div>
  );
}

interface LineProps {
  line: TokenizedLine;
  info: LangInfo;
  mode: ScriptMode;
  nativeLang: string;
  source: string;
  onSave: (draft: SaveWordDraft) => void;
}

function SpeechLine({ line, info, mode, nativeLang, source, onSave }: LineProps) {
  const { t } = useI18n();
  const id = useId();
  const [hoverLine, setHoverLine] = useState(false);
  const [globe, setGlobe] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<number>>(() => new Set());
  const native = mode !== "romanized";
  const pieces = native ? linePieces(line, info.script) : romanizedPieces(line, info.script);
  const showTranslation = (hoverLine || globe) && line.translation !== "";

  const save = (index: number) => {
    const draft = saveWordDraft(line, index, info.lang, info.script, source);
    if (!draft) return;
    setSaved((s) => new Set(s).add(index));
    onSave(draft);
  };

  return (
    <div className="hv-line">
      <div className="hv-line__row">
        <p
          className={`hv-line__text hv-line__text--${mode}`}
          lang={native ? info.lang : info.latinTag}
          dir={native && info.rtl ? "rtl" : "ltr"}
          style={{ fontFamily: fontStack(native ? info.script : "Latn") }}
          onPointerEnter={() => setHoverLine(true)}
          onPointerLeave={() => setHoverLine(false)}
        >
          {pieces.map((piece, i) =>
            piece.kind === "gap" ? (
              <span key={`g${i}`}>{piece.text}</span>
            ) : (
              <Word
                key={`w${piece.index}`}
                token={piece.token}
                info={info}
                mode={mode}
                nativeLang={nativeLang}
                tipId={`${id}-tip-${piece.index}`}
                active={active === piece.index}
                saved={saved.has(piece.index)}
                onActive={(on) => setActive((a) => (on ? piece.index : a === piece.index ? null : a))}
                onSave={() => save(piece.index)}
              />
            ),
          )}
        </p>
        <button
          type="button"
          className="hv-line__globe"
          aria-label={t("speech.translation.show")}
          aria-expanded={showTranslation}
          aria-controls={`${id}-translation`}
          onPointerEnter={() => setGlobe(true)}
          onPointerLeave={() => setGlobe(false)}
          onFocus={() => setGlobe(true)}
          onBlur={() => setGlobe(false)}
          onClick={() => setGlobe((g) => !g)}
        >
          🌐
        </button>
      </div>
      {showTranslation ? (
        <p id={`${id}-translation`} className="hv-line__translation" lang={nativeLang} dir="auto">
          {line.translation}
        </p>
      ) : null}
    </div>
  );
}

interface WordProps {
  token: Token;
  info: LangInfo;
  mode: ScriptMode;
  nativeLang: string;
  tipId: string;
  active: boolean;
  saved: boolean;
  onActive: (on: boolean) => void;
  onSave: () => void;
}

/** Native text, with furigana over the kanji for Japanese. */
function nativeText(token: Token, info: LangInfo, furigana: boolean): ReactNode {
  if (!furigana || info.script !== "Jpan") return token.surface;
  return furiganaSegments(token.surface, japaneseKana(token)).map((seg, i) =>
    seg.ruby ? (
      <ruby key={i}>
        {seg.text}
        <rp>(</rp>
        <rt>{seg.ruby}</rt>
        <rp>)</rp>
      </ruby>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  );
}

function wordContent(token: Token, info: LangInfo, mode: ScriptMode): ReactNode {
  if (mode === "romanized") return tokenRomanized(token, info.script);
  if (mode === "native") return nativeText(token, info, false);
  return (
    <span className="hv-stack">
      <span className="hv-stack__native">{nativeText(token, info, true)}</span>
      <span className="hv-stack__reading" lang={info.latinTag} dir="ltr">
        {tokenReadingLine(token, info.script) || " "}
      </span>
    </span>
  );
}

function Word({ token, info, mode, nativeLang, tipId, active, saved, onActive, onSave }: WordProps) {
  const { t } = useI18n();
  if (isPunctuation(token)) return <span className="hv-punct">{wordContent(token, info, mode)}</span>;
  const kana = info.script === "Jpan" ? japaneseKana(token) : undefined;
  const romanized = info.romanization ? tokenRomanized(token, info.script) : undefined;
  return (
    <span className="hv-word-wrap">
      <button
        type="button"
        className="hv-word"
        data-saved={saved || undefined}
        aria-describedby={active ? tipId : undefined}
        onPointerEnter={() => onActive(true)}
        onPointerLeave={() => onActive(false)}
        onFocus={() => onActive(true)}
        onBlur={() => onActive(false)}
        onClick={onSave}
      >
        {wordContent(token, info, mode)}
      </button>
      {active ? (
        <span role="tooltip" id={tipId} className="hv-tip" dir="ltr">
          <span className="hv-tip__head" lang={info.lang} dir={info.rtl ? "rtl" : "ltr"}>
            {token.lemma && token.lemma !== token.surface ? token.lemma : token.surface}
          </span>
          {kana && kana !== token.surface ? <span lang={info.lang}>{kana}</span> : null}
          {romanized && romanized !== token.surface ? <span lang={info.latinTag}>{romanized}</span> : null}
          {token.gloss ? (
            <span className="hv-tip__gloss" lang={nativeLang} dir="auto">
              {token.gloss}
            </span>
          ) : null}
          {token.pos ? <span className="hv-tip__pos">{t(`speech.pos.${token.pos}` as MessageKey)}</span> : null}
          <span className="hv-tip__hint">{t(saved ? "speech.saved" : "speech.save")}</span>
        </span>
      ) : null}
    </span>
  );
}
