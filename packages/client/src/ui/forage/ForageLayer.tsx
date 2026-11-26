import { useEffect } from "react";
import { type CollectibleId, getForage, itemLabelKey, lostItemOwner } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { requestLabels, useLabelMap } from "../../labels/labelStore";
import { sendPick } from "../../net/forageSession";
import { useAvatar } from "../../state/avatarStore";
import { type ForageStore, forageStore, useForage } from "../../state/forageStore";
import { useWorld } from "../../state/worldStore";
import { itemEnglish } from "../items/items";
import { ForageAlbum } from "./ForageAlbum";
import { FORAGE_ICONS, LOST_ICON } from "./icons";
import "./forage.css";

/** The pick-up notice fades after this long (ms). */
export const FORAGE_NOTICE_MS = 4000;

export interface ForageLayerProps {
  store?: ForageStore;
  /** Sends `forage:pick` (tests inject one). */
  pick?: (spawnId: string) => boolean;
}

/**
 * Foraging on screen (build plan M28, GDD §5.3): next to a forage spawn or a lost item the hint at
 * the bottom names it in the target language with "F: pick up" (and a button), the server's answer
 * shows as a short notice (what went into the bag, new to the album, whose lost item it is, or why
 * not), and the album button opens the forage album the server keeps.
 */
export function ForageLayer({ store = forageStore, pick = (id) => sendPick(id, store) }: ForageLayerProps) {
  const { t } = useI18n();
  const nearbyId = useForage((s) => s.nearby, store);
  const nearby = useForage((s) => (s.nearby ? s.spawns[s.nearby] : undefined), store);
  const picking = useForage((s) => s.picking, store);
  const last = useForage((s) => s.last, store);
  const albumOpen = useForage((s) => s.albumOpen, store);
  const albumLoaded = useForage((s) => s.albumLoaded, store);
  const space = useWorld((s) => s.space);
  const lang = useAvatar((s) => s.profile?.targetLangs[0] ?? null);
  const nativeLang = useAvatar((s) => s.profile?.nativeLang ?? "en");
  const labels = useLabelMap(lang ?? "en");

  useEffect(() => {
    if (lang) requestLabels(lang);
  }, [lang]);
  // The notice fades on its own.
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => {
      if (store.getState().last === last) store.setState({ last: null });
    }, FORAGE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [last, store]);

  const name = (id: CollectibleId) => labels?.[itemLabelKey(id)]?.word ?? itemEnglish(id);
  const icon = (id: string) => {
    const def = getForage(id);
    return def ? FORAGE_ICONS[def.kind] : LOST_ICON;
  };

  let notice: string | null = null;
  if (last?.ok) {
    const owner = last.kind === "lost" ? lostItemOwner(last.itemId) : undefined;
    notice = owner
      ? t("forage.notice.lost", { item: name(last.itemId), name: t(`npc.name.${owner}` as MessageKey) })
      : t(last.first ? "forage.notice.new" : "forage.notice.found", { item: name(last.itemId) });
  } else if (last) {
    notice = t(`forage.notice.${last.reason}` as MessageKey);
  }

  return (
    <>
      {albumLoaded ? (
        <button type="button" className="hv-album-button" aria-expanded={albumOpen} onClick={() => store.setState({ albumOpen: !albumOpen })}>
          📒🌼 <span>{t("forage.album.button")}</span>
        </button>
      ) : null}
      {(space === "town" && nearby) || notice ? (
        <div className="hv-forage" role="status" aria-live="polite">
          {notice ? (
            <p className={`hv-forage__notice${last?.ok ? " hv-forage__notice--ok" : ""}`}>
              {last?.ok ? `${icon(last.itemId)} ` : ""}
              {notice}
            </p>
          ) : null}
          {space === "town" && nearby && nearbyId ? (
            <p className="hv-forage__hint">
              <span aria-hidden="true">{icon(nearby.itemId)}</span>{" "}
              <span lang={labels?.[itemLabelKey(nearby.itemId)] ? (lang ?? undefined) : "en"}>{name(nearby.itemId)}</span>{" "}
              <button type="button" aria-keyshortcuts="F" disabled={picking !== null} onClick={() => pick(nearbyId)}>
                {t("forage.pick")}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      {albumOpen && lang ? <ForageAlbum store={store} lang={lang} nativeLang={nativeLang} /> : null}
    </>
  );
}
