import { useEffect, useRef, useState } from "react";
import { ELDER_BARK_LEVEL, itemLabelKey, notebookEntryId } from "@hellovalley/shared";
import { lazyTts, loadElderBark } from "../../ai/client";
import type { BarkLine } from "../../ai/barks";
import type { TtsSpeaker } from "../../ai/tts";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { useLabel } from "../../labels/labelStore";
import { type FishingStore, useFishing } from "../../state/fishingStore";
import { useNotebook } from "../../state/notebookStore";
import { itemEnglish } from "../items/items";
import { LabelChip } from "../labels/LabelChip";
import { emitSaveWord } from "../speech/wordEvents";
import { type VoicePlayer, voicePlayer } from "../speech/voicePlayer";

export interface CatchCardProps {
  store: FishingStore;
  lang: string;
  nativeLang: string;
  onClose: () => void;
  /** The Elder's comment (default: the seeded cache, else the player's own generation). */
  bark?: (input: { fishId: Parameters<typeof loadElderBark>[0]["fishId"]; targetLang: string; nativeLang: string }) => Promise<BarkLine | null>;
  tts?: TtsSpeaker;
  player?: VoicePlayer;
}

/**
 * The catch card (build plan M27, GDD §5.2: "each labelled with its target-language name and audio
 * when caught"): the fish's world label in the target language (click to hear it; the save button
 * puts it in the notebook as `object:item.<fishId>`), its rarity, whether it is a new species and
 * whether it went into the bag. When the Elder is fishing on the dock nearby he comments on the
 * catch (a cached bark, voiced with his TTS voice).
 */
export function CatchCard({ store, lang, nativeLang, onClose, bark = loadElderBark, tts = lazyTts, player = voicePlayer() }: CatchCardProps) {
  const { t } = useI18n();
  const result = useFishing((s) => s.result, store);
  const caught = result?.outcome === "caught" ? result : null;
  const labelKey = caught ? itemLabelKey(caught.fishId) : null;
  const label = useLabel(lang, labelKey);
  const entryId = label ? notebookEntryId({ surface: label.word }) : null;
  const saved = useNotebook((s) => entryId !== null && s.items.some((i) => i.id === entryId));
  const [elder, setElder] = useState<BarkLine | null>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => close.current?.focus(), []);

  const fishId = caught?.fishId;
  const elderNearby = caught?.elderNearby ?? false;
  useEffect(() => {
    if (!fishId || !elderNearby) return;
    let cancelled = false;
    void bark({ fishId, targetLang: lang, nativeLang }).then((line) => {
      if (cancelled || !line) return;
      setElder(line);
      void tts.clip({ npcId: "elder", lang, level: ELDER_BARK_LEVEL, text: line.text, seeded: true }).then((r) => {
        if (!cancelled && r.ok) player.play(r.clip, 1).catch(() => undefined);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fishId, elderNearby, lang, nativeLang, bark, tts, player]);

  if (!caught || !labelKey) return null;
  const save = () => {
    if (!label) return;
    emitSaveWord({ lang, surface: label.word, ...(label.reading ? { reading: label.reading } : {}), example: label.word, source: `object:${labelKey}` });
  };
  const playElder = () => {
    if (!elder) return;
    void tts.clip({ npcId: "elder", lang, level: ELDER_BARK_LEVEL, text: elder.text, seeded: true }).then((r) => {
      if (r.ok) player.play(r.clip, 1).catch(() => undefined);
    });
  };
  return (
    <div className="hv-catch" role="dialog" aria-modal="false" aria-labelledby="hv-catch-title">
      <h2 id="hv-catch-title" className="hv-catch__title">
        {t("fishing.card.title")}
      </h2>
      <div className={`hv-catch__fish hv-catch__fish--${caught.rarity}`} aria-hidden="true">
        🐟
      </div>
      <div className="hv-catch__name">
        <LabelChip lang={lang} labelKey={labelKey} tts={tts} player={player} />
        {nativeLang === "en" ? <span className="hv-catch__english">{itemEnglish(caught.fishId)}</span> : null}
      </div>
      <p className="hv-catch__meta">
        <span className={`hv-rarity hv-rarity--${caught.rarity}`}>{t(`fishing.rarity.${caught.rarity}` as MessageKey)}</span>
        {caught.first ? <span className="hv-catch__new">{t("fishing.card.new")}</span> : null}
        <span>{t("fishing.card.count", { count: String(caught.entry.count) })}</span>
      </p>
      <p className="hv-catch__bag">{t(caught.kept ? "fishing.card.kept" : "fishing.card.released")}</p>
      {elder ? (
        <blockquote className="hv-catch__elder">
          <span className="hv-catch__elder-who">{t("fishing.card.elder")}</span>
          <span lang={lang}>{elder.text}</span>
          {elder.reading ? <span className="hv-catch__elder-reading">{elder.reading}</span> : null}
          {elder.translation ? <span className="hv-catch__elder-translation">{elder.translation}</span> : null}
          <button type="button" className="hv-catch__elder-play" aria-label={t("fishing.card.elderPlay")} onClick={playElder}>
            🔊
          </button>
        </blockquote>
      ) : null}
      <div className="hv-catch__actions">
        <button type="button" onClick={save} disabled={!label || saved}>
          {saved ? `✓ ${t("fishing.card.saved")}` : t("fishing.card.save")}
        </button>
        <button type="button" onClick={() => store.setState({ bookOpen: true })}>
          {t("fishing.book.button")}
        </button>
        <button ref={close} type="button" onClick={onClose}>
          {t("fishing.card.close")}
        </button>
      </div>
    </div>
  );
}
