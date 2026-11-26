import { useEffect, useRef } from "react";
import { FISH, type FishDef, fishLogStats, itemLabelKey, TIMES_OF_DAY, WEATHERS } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { requestLabels, useLabelMap } from "../../labels/labelStore";
import { type FishingStore, useFishing } from "../../state/fishingStore";
import { itemEnglish } from "../items/items";

export interface FishBookProps {
  store: FishingStore;
  lang: string;
  nativeLang: string;
}

/**
 * The fish encyclopedia (build plan M27, GDD §2 "Collections"): all 18 species, in data order.
 * Caught ones show their target-language name (world labels), rarity and how many were caught;
 * the rest stay a silhouette with a hint of when and in what weather they bite. The data is the
 * server's (`fish:log`, `users/{uid}/collections/fish`), so it is the same on every device.
 */
export function FishBook({ store, lang, nativeLang }: FishBookProps) {
  const { t } = useI18n();
  const log = useFishing((s) => s.log, store);
  const labels = useLabelMap(lang);
  const stats = fishLogStats(log);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    requestLabels(lang);
  }, [lang]);
  useEffect(() => close.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") store.setState({ bookOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const when = (fish: FishDef) => {
    const times = fish.times.length === TIMES_OF_DAY.length ? t("fishing.anyTime") : fish.times.map((x) => t(`fishing.time.${x}` as MessageKey)).join(", ");
    const weather = fish.weather.length === WEATHERS.length ? t("fishing.anyWeather") : fish.weather.map((x) => t(`fishing.weather.${x}` as MessageKey)).join(", ");
    return t("fishing.book.when", { times, weather });
  };

  return (
    <section className="hv-fishbook" role="dialog" aria-modal="false" aria-labelledby="hv-fishbook-title">
      <header className="hv-fishbook__header">
        <h2 id="hv-fishbook-title">{t("fishing.book.title")}</h2>
        <span>{t("fishing.book.progress", { caught: String(stats.species), total: String(FISH.length) })}</span>
        <button ref={close} type="button" aria-label={t("fishing.book.close")} onClick={() => store.setState({ bookOpen: false })}>
          ✕
        </button>
      </header>
      <ul className="hv-fishbook__grid">
        {FISH.map((fish) => {
          const entry = log[fish.id];
          const label = labels?.[itemLabelKey(fish.id)];
          return (
            <li key={fish.id} className={`hv-fishbook__fish${entry ? "" : " hv-fishbook__fish--unknown"}`} data-fish={fish.id}>
              <span className={`hv-fishbook__icon hv-catch__fish--${fish.rarity}`} aria-hidden="true">
                {entry ? "🐟" : "❔"}
              </span>
              {entry ? (
                <>
                  <span className="hv-fishbook__word" lang={label ? lang : "en"} title={nativeLang === "en" ? itemEnglish(fish.id) : undefined}>
                    {label?.word ?? itemEnglish(fish.id)}
                  </span>
                  {label?.reading ? <span className="hv-fishbook__reading">{label.reading}</span> : null}
                  <span className="hv-fishbook__count">{t("fishing.book.count", { count: String(entry.count) })}</span>
                </>
              ) : (
                <span className="hv-fishbook__word">{t("fishing.book.unknown")}</span>
              )}
              <span className={`hv-rarity hv-rarity--${fish.rarity}`}>{t(`fishing.rarity.${fish.rarity}` as MessageKey)}</span>
              <span className="hv-fishbook__when">
                {when(fish)}
                {fish.spots.length === 1 && fish.spots[0] === "secret" ? ` · ${t("fishing.book.secret")}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
