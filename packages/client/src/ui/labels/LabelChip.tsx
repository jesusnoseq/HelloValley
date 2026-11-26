import { labelEnglish, notebookEntryId, wordTtsLine } from "@hellovalley/shared";
import { lazyTts } from "../../ai/client";
import type { TtsSpeaker } from "../../ai/tts";
import { useI18n } from "../../i18n/I18nProvider";
import { useLabel } from "../../labels/labelStore";
import { useNotebook } from "../../state/notebookStore";
import { emitSaveWord } from "../speech/wordEvents";
import { type VoicePlayer, voicePlayer } from "../speech/voicePlayer";
import "./labels.css";

export interface LabelChipProps {
  lang: string;
  labelKey: string;
  tts?: TtsSpeaker;
  player?: VoicePlayer;
}

/**
 * A world label (GDD §6.5, build plan M25): the object's word in the target language and its
 * reading. Clicking the word plays it (the seeded clip when the seeding tool voiced it, else the
 * player's own TTS) and saves it to the notebook with the source `object:<labelKey>`. While the
 * label is not there (loading, or no AI backend) the English word shows, greyed, and does nothing.
 */
export function LabelChip({ lang, labelKey, tts = lazyTts, player = voicePlayer() }: LabelChipProps) {
  const { t } = useI18n();
  const label = useLabel(lang, labelKey);
  const id = label ? notebookEntryId({ surface: label.word }) : null;
  const saved = useNotebook((s) => id !== null && s.items.some((i) => i.id === id));
  if (!label) {
    return (
      <span className="hv-label hv-label--missing" lang="en">
        {labelEnglish(labelKey)}
      </span>
    );
  }
  const source = `object:${labelKey}`;
  const play = () => {
    void tts.clip({ ...wordTtsLine({ surface: label.word, source }, lang), seeded: true }).then((r) => {
      if (r.ok) player.play(r.clip, 1).catch(() => undefined);
    });
  };
  const onClick = () => {
    play();
    emitSaveWord({ lang, surface: label.word, ...(label.reading ? { reading: label.reading } : {}), example: label.word, source });
  };
  return (
    <span className="hv-label">
      <button type="button" className="hv-label__word" lang={lang} onClick={onClick} title={t(saved ? "labels.saved" : "labels.save")}>
        <span>{label.word}</span>
        {label.reading ? <span className="hv-label__reading">{label.reading}</span> : null}
      </button>
      <button type="button" className="hv-label__play" aria-label={t("labels.play")} onClick={play}>
        🔊
      </button>
      {saved ? (
        <span className="hv-label__saved" role="status" aria-label={t("labels.saved")}>
          ✓
        </span>
      ) : null}
    </span>
  );
}
