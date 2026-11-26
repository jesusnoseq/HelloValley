import { type ReactNode, useEffect, useState } from "react";
import { type Level, type QuestKind, questCard, type QuestNotice, type QuestView } from "@hellovalley/shared";
import { loadQuestNotice } from "../../ai/client";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import type { LabelMap } from "../../labels/labelSource";
import { LabelChip } from "../labels/LabelChip";
import { itemIcon, itemName } from "../items/items";

/** Loads a request's notice (tests inject one). */
export type NoticeLoader = (input: { templateId: string; targetLang: string; nativeLang: string; level: Level }) => Promise<QuestNotice | null>;

export const KIND_ICONS: Readonly<Record<QuestKind, string>> = { deliver: "📦", fetch: "🧺", catch: "🎣", cook: "🍳", find: "🔎" };

export interface QuestCardProps {
  view: QuestView;
  lang: string;
  nativeLang: string;
  level: Level;
  labels: LabelMap | null;
  notice?: NoticeLoader;
  /** The card's buttons (Accept on the board). */
  children?: ReactNode;
}

/**
 * One request (build plan M30, GDD §5.5 "written in the target language at the player's level"):
 * the Mayor's notice in the target language (seeded or generated once per player, translations on
 * hover), then the request as world labels — the verb, what and how many, who asked and who gets
 * it — every word clickable into the notebook like the recipe cards, so the details read in the
 * target language even without a notice. Then the deadline, the progress and the reward.
 */
export function QuestCard({ view, lang, nativeLang, level, labels, notice = loadQuestNotice, children }: QuestCardProps) {
  const { t } = useI18n();
  const [text, setText] = useState<{ id: string; notice: QuestNotice | null } | null>(null);
  const card = questCard({ template: { id: view.templateId, giver: view.giver, target: view.target } });
  const id = `${view.templateId}|${lang}|${nativeLang}|${level}`;

  useEffect(() => {
    let live = true;
    void notice({ templateId: view.templateId, targetLang: lang, nativeLang, level }).then((n) => {
      if (live) setText({ id, notice: n });
    });
    return () => {
      live = false;
    };
  }, [id, notice, view.templateId, lang, nativeLang, level]);

  const loaded = text?.id === id ? text : null;
  const npc = (npcId: string) => t(`npc.name.${npcId}` as MessageKey);
  const kind = view.target.kind;
  const status = view.status === "open" ? null : t(`quests.status.${view.status}` as MessageKey);

  return (
    <article className={`hv-quest hv-quest--${view.status}`} data-quest={view.templateId} aria-label={npc(view.giver)}>
      <header className="hv-quest__head">
        <span className="hv-quest__icon" aria-hidden="true">
          {KIND_ICONS[kind]}
        </span>
        {loaded?.notice ? (
          <div className="hv-quest__notice" lang={lang}>
            <h3 title={loaded.notice.title.translation || undefined}>
              {loaded.notice.title.text}
              {loaded.notice.title.reading ? <span className="hv-quest__reading">{loaded.notice.title.reading}</span> : null}
            </h3>
            {loaded.notice.body.map((line, i) => (
              <p key={i} title={line.translation || undefined}>
                {line.text}
                {line.reading ? <span className="hv-quest__reading">{line.reading}</span> : null}
              </p>
            ))}
          </div>
        ) : (
          <p className="hv-quest__notice hv-quest__notice--missing">{t(loaded ? "quests.notice.unavailable" : "quests.notice.loading")}</p>
        )}
        {status ? <span className={`hv-quest__status hv-quest__status--${view.status}`}>{status}</span> : null}
      </header>
      <p className="hv-quest__card">
        <LabelChip lang={lang} labelKey={card.verbKey} /> <span className="hv-quest__qty">{card.qty} ×</span> <LabelChip lang={lang} labelKey={card.whatKey} />
        {card.toKey ? (
          <>
            {" → "}
            <LabelChip lang={lang} labelKey={card.toKey} />
          </>
        ) : null}
        {card.by ? (
          <>
            {" ⏰ "}
            <LabelChip lang={lang} labelKey="quest.before" /> {card.by}
          </>
        ) : null}
      </p>
      <p className="hv-quest__meta">
        <span>{t("quests.from", { name: npc(view.giver) })}</span>
        <span>{view.turnIn ? t("quests.handTo", { name: npc(view.turnIn) }) : t("quests.auto")}</span>
        <span>{card.by ? t("quests.by", { time: card.by }) : t("quests.today")}</span>
        {view.status === "active" && !view.turnIn ? <span className="hv-quest__progress">{t("quests.progress", { done: String(view.progress), total: String(view.target.qty) })}</span> : null}
      </p>
      <p className="hv-quest__reward">
        🪙 {t("quests.reward", { coins: String(view.reward.coins), hearts: String(view.reward.hearts), name: npc(view.giver) })}
        {view.reward.itemId ? (
          <span className="hv-quest__bonus">
            {" "}
            {itemIcon(view.reward.itemId)} {t("quests.reward.bonus", { item: itemName(view.reward.itemId, labels) })}
          </span>
        ) : null}
      </p>
      {children}
    </article>
  );
}
