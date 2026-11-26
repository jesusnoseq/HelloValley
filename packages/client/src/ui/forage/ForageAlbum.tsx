import { useEffect, useRef } from "react";
import { albumStats, type CollectibleId, FORAGE, itemLabelKey, LOST_ITEMS } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { requestLabels, useLabelMap } from "../../labels/labelStore";
import { type ForageStore, useForage } from "../../state/forageStore";
import { itemEnglish } from "../items/items";
import { FORAGE_ICONS, LOST_ICON } from "./icons";

export interface ForageAlbumProps {
  store: ForageStore;
  lang: string;
  nativeLang: string;
}

/**
 * The forage album (build plan M28, GDD §2 "Collections: foraged-item album"): every forage item
 * in data order, then the villagers' lost items. Found ones show their target-language name
 * (world labels), how often they were found, and for lost items how often they went back to their
 * owner; the rest stay a silhouette with a hint of where they grow (or whose they are). The data
 * is the server's (`forage:album`, `users/{uid}/collections/forage`), the same on every device.
 */
export function ForageAlbum({ store, lang, nativeLang }: ForageAlbumProps) {
  const { t } = useI18n();
  const album = useForage((s) => s.album, store);
  const labels = useLabelMap(lang);
  const stats = albumStats(album);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    requestLabels(lang);
  }, [lang]);
  useEffect(() => close.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") store.setState({ albumOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const word = (id: CollectibleId) => {
    const label = labels?.[itemLabelKey(id)];
    return (
      <>
        <span className="hv-album__word" lang={label ? lang : "en"} title={nativeLang === "en" ? itemEnglish(id) : undefined}>
          {label?.word ?? itemEnglish(id)}
        </span>
        {label?.reading ? <span className="hv-album__reading">{label.reading}</span> : null}
      </>
    );
  };

  return (
    <section className="hv-album" role="dialog" aria-modal="false" aria-labelledby="hv-album-title">
      <header className="hv-album__header">
        <h2 id="hv-album-title">{t("forage.album.title")}</h2>
        <span>{t("forage.album.progress", { found: String(stats.forage.found), total: String(stats.forage.of) })}</span>
        <button ref={close} type="button" aria-label={t("forage.album.close")} onClick={() => store.setState({ albumOpen: false })}>
          ✕
        </button>
      </header>
      <ul className="hv-album__grid" aria-label={t("forage.album.forage")}>
        {FORAGE.map((f) => {
          const entry = album.found[f.id];
          return (
            <li key={f.id} className={`hv-album__item${entry ? "" : " hv-album__item--unknown"}`} data-item={f.id}>
              <span className="hv-album__icon" aria-hidden="true">
                {entry ? FORAGE_ICONS[f.kind] : "❔"}
              </span>
              {entry ? (
                <>
                  {word(f.id)}
                  <span className="hv-album__count">{t("forage.album.count", { count: String(entry.count) })}</span>
                </>
              ) : (
                <span className="hv-album__word">{t("forage.album.unknown")}</span>
              )}
              <span className={`hv-rarity hv-rarity--${f.rarity}`}>{t(`fishing.rarity.${f.rarity}` as MessageKey)}</span>
              <span className="hv-album__where">{f.zones.map((z) => t(`forage.zone.${z}` as MessageKey)).join(", ")}</span>
            </li>
          );
        })}
      </ul>
      <h3 className="hv-album__subtitle">
        {t("forage.album.lost")} · {t("forage.album.lostProgress", { found: String(stats.lost.found), total: String(stats.lost.of), returned: String(stats.returned) })}
      </h3>
      <ul className="hv-album__grid" aria-label={t("forage.album.lost")}>
        {LOST_ITEMS.map((l) => {
          const entry = album.found[l.id];
          const returned = album.returned[l.id]?.count ?? 0;
          const owner = t(`npc.name.${l.owner}` as MessageKey);
          return (
            <li key={l.id} className={`hv-album__item${entry ? "" : " hv-album__item--unknown"}`} data-item={l.id}>
              <span className="hv-album__icon" aria-hidden="true">
                {entry ? LOST_ICON : "❔"}
              </span>
              {entry ? word(l.id) : <span className="hv-album__word">{t("forage.album.unknown")}</span>}
              <span className="hv-album__where">{t("forage.album.owner", { name: owner })}</span>
              {entry ? <span className="hv-album__count">{t("forage.album.returned", { count: String(returned) })}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
