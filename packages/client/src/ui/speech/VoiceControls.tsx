import { useEffect, useState } from "react";
import { TTS_SLOW_RATE } from "@hellovalley/shared";
import { lazyTts } from "../../ai/client";
import type { TtsClip, TtsLineRequest, TtsSpeaker } from "../../ai/tts";
import { useI18n } from "../../i18n/I18nProvider";
import { type VoicePlayer, voicePlayer } from "./voicePlayer";

export interface VoiceControlsProps {
  /** The line as shown; its audio is requested only after the text is on screen. */
  line: TtsLineRequest;
  /** Plays the clip once when it arrives (GDD §6.1). */
  autoPlay?: boolean;
  /** TTS and playback (tests replace them). */
  tts?: TtsSpeaker;
  player?: VoicePlayer;
}

type VoiceState = { status: "loading" } | { status: "ready"; clip: TtsClip } | { status: "muted" };

/**
 * The NPC voice for one line (build plan M22, GDD §6.1): a replay button and a 🐢 button that
 * replays at 0.75× on the client (no new generation), or a 🔇 badge when there is no audio. The
 * parent renders the text first; the clip is fetched in an effect, after that render is on
 * screen, and played once when it arrives.
 */
export function VoiceControls({ line, autoPlay = true, tts = lazyTts, player = voicePlayer() }: VoiceControlsProps) {
  const { t } = useI18n();
  const { npcId, lang, level, text, ttsTags, emotion, seeded } = line;
  const key = JSON.stringify([npcId, lang, level, text, ttsTags ?? "", emotion ?? "", seeded ?? false]);
  // The answer is stored with the line it belongs to, so a new line reads as loading at once.
  const [answer, setAnswer] = useState<{ key: string; state: VoiceState } | null>(null);
  const state: VoiceState = answer?.key === key ? answer.state : { status: "loading" };

  useEffect(() => {
    let cancelled = false;
    void tts.clip({ npcId, lang, level, text, ttsTags, emotion, seeded }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setAnswer({ key, state: { status: "muted" } });
        return;
      }
      setAnswer({ key, state: { status: "ready", clip: result.clip } });
      // Autoplay can be refused (no user gesture yet): the replay button still works.
      if (autoPlay) player.play(result.clip, 1).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [tts, player, autoPlay, key, npcId, lang, level, text, ttsTags, emotion, seeded]);

  if (state.status === "loading") {
    return (
      <span className="hv-voice hv-voice--loading" role="status" aria-label={t("speech.audio.loading")}>
        …
      </span>
    );
  }
  if (state.status === "muted") {
    return (
      <span className="hv-voice hv-voice--muted" role="img" aria-label={t("speech.audio.unavailable")} title={t("speech.audio.unavailable")}>
        🔇
      </span>
    );
  }
  const play = (rate: number) => void player.play(state.clip, rate).catch(() => undefined);
  return (
    <span className="hv-voice">
      <button type="button" className="hv-voice__button" aria-label={t("speech.audio.replay")} title={t("speech.audio.replay")} onClick={() => play(1)}>
        🔁
      </button>
      <button type="button" className="hv-voice__button" aria-label={t("speech.audio.slow")} title={t("speech.audio.slow")} onClick={() => play(TTS_SLOW_RATE)}>
        🐢
      </button>
    </span>
  );
}
