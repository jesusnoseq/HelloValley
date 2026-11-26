import { useId } from "react";
import { friendshipBand, isGiftable, type ItemId, isLostItemId, lostItemOwner, MAX_HEARTS, type NpcContextMessage } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import type { ConversationController } from "./controller";
import { useLabelMap } from "../../labels/labelStore";
import { itemName } from "../items/items";
import { sendVillagePrivacy, useNpcBarks } from "../../net/npcBarks";
import { useTownSession } from "../../net/townSession";

/** Item names live with the inventory UI (build plan M26); re-exported for the conversation panel. */
export { itemName };

/** Hearts as a short number in the UI language (2.25 → "2.25", 3 → "3"). */
export function formatHearts(hearts: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hearts);
}

/** "+1", "−0.5": a hearts change with its sign. */
export function formatHeartsDelta(delta: number, locale: string): string {
  const n = formatHearts(Math.abs(delta), locale);
  return delta < 0 ? `−${n}` : `+${n}`;
}

/** Ten hearts, filled to the friendship level (quarters show as a partly filled heart). */
export function HeartsMeter({ hearts }: { hearts: number }) {
  const { t, locale } = useI18n();
  return (
    <span className="hv-hearts" role="img" aria-label={t("convo.profile.hearts", { hearts: formatHearts(hearts, locale), max: String(MAX_HEARTS) })}>
      {Array.from({ length: MAX_HEARTS }, (_, i) => {
        const fill = Math.min(1, Math.max(0, hearts - i));
        return (
          <span key={i} aria-hidden="true" className={`hv-heart hv-heart--${fill >= 1 ? "full" : fill > 0 ? "part" : "empty"}`} style={fill > 0 && fill < 1 ? { ["--fill" as string]: `${fill * 100}%` } : undefined}>
            ♥
          </span>
        );
      })}
    </span>
  );
}

export interface NpcProfileCardProps {
  context: NpcContextMessage;
  name: string;
  controller: ConversationController;
  /** The item on its way to the server, if any. */
  gifting: ItemId | null;
  /** The conversation is still going (gifts need it). */
  canGive: boolean;
}

/**
 * The NPC profile card (build plan M24, GDD §8.2): who the NPC is, the hearts with them (0–10),
 * the friendship band, what this visit did (daily greeting, decay after a week away), when the
 * player last talked to them, and the gift picker (one gift per NPC per in-game day; the NPC's
 * liked and disliked items are found out by giving), and (build plan M28) the NPC's lost items the
 * player found, to hand back for hearts. Build plan M31: on the Gossip's and the Elder's cards, the
 * village news setting (GDD §8.2: may they use the player's name in rumours and legends?).
 */
export function NpcProfileCard({ context, name, controller, gifting, canGive }: NpcProfileCardProps) {
  const { t, locale } = useI18n();
  const titleId = useId();
  const labels = useLabelMap(context.lang);
  const band = friendshipBand(context.hearts);
  const giftable = context.inventory.filter((e) => e.qty > 0 && isGiftable(e.itemId));
  // Build plan M28: this NPC's lost items the player found.
  const theirs = context.inventory.flatMap((e) => (e.qty > 0 && isLostItemId(e.itemId) && lostItemOwner(e.itemId) === context.npcId ? [e.itemId] : []));
  const named = useNpcBarks((s) => s.named);
  const room = useTownSession((s) => s.room);
  const newsy = context.npcId === "gossip" || context.npcId === "elder";
  const lastSeen = context.lastSeen !== null ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(context.lastSeen)) : null;
  return (
    <section className="hv-profile" aria-labelledby={titleId}>
      <h3 id={titleId} className="hv-profile__title">
        {name} · <span className="hv-profile__role">{t(`npc.role.${context.npcId}` as MessageKey)}</span>
      </h3>
      <p className="hv-profile__hearts">
        <HeartsMeter hearts={context.hearts} />
        <span>
          {formatHearts(context.hearts, locale)} / {MAX_HEARTS} · {t(`convo.profile.band.${band}` as MessageKey)}
        </span>
      </p>
      {context.contact.greeting > 0 ? <p className="hv-profile__note">{t("convo.profile.greeting", { delta: formatHeartsDelta(context.contact.greeting, locale) })}</p> : null}
      {context.contact.decay < 0 ? <p className="hv-profile__note">{t("convo.profile.decay", { name, delta: formatHeartsDelta(context.contact.decay, locale) })}</p> : null}
      <p className="hv-profile__note">{lastSeen ? t("convo.profile.lastSeen", { date: lastSeen }) : t("convo.profile.firstMeeting")}</p>
      {canGive ? (
        <div role="group" aria-label={t("convo.profile.gift")} className="hv-profile__gifts">
          <span>{t("convo.profile.gift")}:</span>
          {context.giftedToday ? (
            <span>{t("convo.profile.giftedToday", { name })}</span>
          ) : giftable.length === 0 ? (
            <span>{t("convo.profile.nothingToGive")}</span>
          ) : (
            giftable.map((e) => (
              <button key={e.itemId} type="button" disabled={gifting !== null} aria-busy={gifting === e.itemId || undefined} onClick={() => void controller.gift(e.itemId)}>
                🎁 {itemName(e.itemId, labels)} ×{e.qty}
              </button>
            ))
          )}
        </div>
      ) : null}
      {canGive && theirs.length > 0 ? (
        <div role="group" aria-label={t("convo.profile.return")} className="hv-profile__gifts">
          <span>{t("convo.profile.return")}:</span>
          {theirs.map((itemId) => (
            <button key={itemId} type="button" disabled={gifting !== null} aria-busy={gifting === itemId || undefined} onClick={() => void controller.returnLost(itemId)}>
              ✨ {itemName(itemId, labels)}
            </button>
          ))}
        </div>
      ) : null}
      {newsy && named !== null ? (
        <label className="hv-profile__note">
          <input type="checkbox" checked={named} onChange={(e) => sendVillagePrivacy(room, e.target.checked)} /> {t("convo.profile.villageNamed")}
        </label>
      ) : null}
    </section>
  );
}
