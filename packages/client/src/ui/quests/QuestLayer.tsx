import { type ReactNode, useEffect, useRef } from "react";
import { itemCounts, type QuestView } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { requestLabels, useLabelMap } from "../../labels/labelStore";
import { sendAccept, sendHandOver } from "../../net/questSession";
import { useAvatar } from "../../state/avatarStore";
import { type ConversationStore, conversationStore, useConversation } from "../../state/conversationStore";
import { type InventoryStore, inventoryStore, useInventory } from "../../state/inventoryStore";
import { type QuestStore, questStore, useQuests } from "../../state/questStore";
import { useWorld } from "../../state/worldStore";
import { itemName } from "../items/items";
import { type NoticeLoader, QuestCard } from "./QuestCard";
import "./quests.css";

/** Result notices fade after this long (ms). */
export const QUEST_NOTICE_MS = 5000;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export interface QuestLayerProps {
  store?: QuestStore;
  conversation?: ConversationStore;
  inventory?: InventoryStore;
  notice?: NoticeLoader;
  accept?: (questId: string) => boolean;
  handOver?: (conversationId: string, questId: string) => boolean;
}

/** The item a hand-in request takes (deliveries and fetches). */
const handInItem = (v: QuestView) => (v.target.kind === "deliver" || v.target.kind === "fetch" ? { itemId: v.target.itemId, qty: v.target.qty } : null);

/**
 * Daily requests on screen (build plan M30, GDD §5.5): at the Town Hall notice board "Read the
 * notice board (F)" opens today's three requests with an Accept button each; the Requests button
 * (or J) opens the quest log with what the player took on, its progress and status; during a
 * conversation with the villager a delivery or fetch goes to, a "Hand over" card sends it
 * (`quest:handover`); and the server's answers (accepted, done with the reward, or why not) show
 * as a short notice. The server decides every accept, every step and every reward.
 */
export function QuestLayer({
  store = questStore,
  conversation = conversationStore,
  inventory = inventoryStore,
  notice,
  accept = (questId) => sendAccept(questId, store),
  handOver = (conversationId, questId) => sendHandOver(conversationId, questId, store),
}: QuestLayerProps) {
  const { t } = useI18n();
  const day = useQuests((s) => s.day, store);
  const level = useQuests((s) => s.level, store) ?? "A1";
  const board = useQuests((s) => s.board, store);
  const log = useQuests((s) => s.log, store);
  const last = useQuests((s) => s.last, store);
  const sending = useQuests((s) => s.sending, store);
  const boardOpen = useQuests((s) => s.boardOpen, store);
  const logOpen = useQuests((s) => s.logOpen, store);
  const nearby = useWorld((s) => s.nearby);
  const lang = useAvatar((s) => s.profile?.targetLangs[0] ?? null);
  const nativeLang = useAvatar((s) => s.profile?.nativeLang ?? "en");
  const labels = useLabelMap(lang ?? "en");
  const talkingTo = useConversation((s) => (s.phase !== "idle" && s.phase !== "unavailable" ? s.npcId : null), conversation);
  const conversationId = useConversation((s) => s.context?.conversationId ?? null, conversation);
  const slots = useInventory((s) => s.slots, inventory);
  const boardClose = useRef<HTMLButtonElement>(null);
  const logClose = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (lang) requestLabels(lang);
  }, [lang]);
  // The notice fades on its own.
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => {
      if (store.getState().last === last) store.setState({ last: null });
    }, QUEST_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [last, store]);
  // The board closes when the player walks away from it.
  const atBoard = nearby?.kind === "notice_board";
  useEffect(() => {
    if (boardOpen && !atBoard) store.setState({ boardOpen: false });
  }, [boardOpen, atBoard, store]);
  useEffect(() => {
    if (boardOpen) boardClose.current?.focus();
  }, [boardOpen]);
  useEffect(() => {
    if (logOpen) logClose.current?.focus();
  }, [logOpen]);
  // J toggles the log; Escape closes the board, then the log.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      const s = store.getState();
      if (e.code === "Escape" && (s.boardOpen || s.logOpen)) {
        e.preventDefault();
        store.setState(s.boardOpen ? { boardOpen: false } : { logOpen: false });
        return;
      }
      if (e.code === "KeyJ" && !e.repeat && s.day !== null) store.setState({ logOpen: !s.logOpen });
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [store]);

  if (day === null || !lang) return null;

  const npc = (id: string) => t(`npc.name.${id}` as MessageKey);
  const counts = itemCounts(slots);
  const active = log.filter((v) => v.status === "active");
  const handIns = talkingTo && conversationId ? active.filter((v) => v.turnIn === talkingTo) : [];

  let result: string | null = null;
  if (last?.ok && last.action === "accept") result = t("quests.result.accepted");
  else if (last?.ok && last.action === "complete") {
    const view = [...log, ...board].find((v) => v.questId === last.questId);
    result = t("quests.result.completed", { coins: String(last.reward.coins), hearts: String(last.reward.hearts), name: view ? npc(view.giver) : "" });
  } else if (last && !last.ok) result = t(`quests.result.refused.${last.reason}` as MessageKey);

  const card = (view: QuestView, actions?: ReactNode) => (
    <QuestCard key={view.questId} view={view} lang={lang} nativeLang={nativeLang} level={level} labels={labels} {...(notice ? { notice } : {})}>
      {actions}
    </QuestCard>
  );

  return (
    <>
      <button type="button" className="hv-quests-button" aria-expanded={logOpen} aria-keyshortcuts="J" onClick={() => store.setState({ logOpen: !logOpen })}>
        📜 <span>{t("quests.log.button")}</span>
        {active.length ? <span className="hv-quests-button__count">{active.length}</span> : null}
      </button>
      {(atBoard && !boardOpen) || result ? (
        <div className="hv-quest-hint" role="status" aria-live="polite">
          {result ? <p className={`hv-quest-hint__notice${last?.ok ? " hv-quest-hint__notice--ok" : ""}`}>{result}</p> : null}
          {atBoard && !boardOpen ? (
            <p>
              <button type="button" aria-keyshortcuts="F" onClick={() => store.setState({ boardOpen: true })}>
                📋 {t("quests.board.open")}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      {handIns.length ? (
        <aside className="hv-quest-handover" aria-label={t("quests.log.title")}>
          {handIns.map((v) => {
            const item = handInItem(v)!;
            const enough = (counts[item.itemId] ?? 0) >= item.qty;
            const label = { qty: String(item.qty), item: itemName(item.itemId, labels) };
            return (
              <p key={v.questId}>
                <button type="button" disabled={!enough || sending !== null} onClick={() => handOver(conversationId!, v.questId)}>
                  🤝 {t(enough ? "quests.handover" : "quests.handover.missing", label)}
                </button>
              </p>
            );
          })}
        </aside>
      ) : null}
      {boardOpen ? (
        <section className="hv-quests hv-quests--board" role="dialog" aria-modal="false" aria-labelledby="hv-quests-board-title">
          <header className="hv-quests__header">
            <h2 id="hv-quests-board-title">📋 {t("quests.board.title")}</h2>
            <button ref={boardClose} type="button" aria-label={t("quests.board.close")} onClick={() => store.setState({ boardOpen: false })}>
              ✕
            </button>
          </header>
          {board.length === 0 ? <p>{t("quests.board.empty")}</p> : null}
          {board.map((v) =>
            card(
              v,
              v.status === "open" ? (
                <p className="hv-quest__actions">
                  <button type="button" disabled={sending !== null} onClick={() => accept(v.questId)}>
                    {t("quests.accept")}
                  </button>
                </p>
              ) : undefined,
            ),
          )}
        </section>
      ) : null}
      {logOpen ? (
        <section className="hv-quests hv-quests--log" role="dialog" aria-modal="false" aria-labelledby="hv-quests-log-title">
          <header className="hv-quests__header">
            <h2 id="hv-quests-log-title">📜 {t("quests.log.title")}</h2>
            <button ref={logClose} type="button" aria-label={t("quests.log.close")} onClick={() => store.setState({ logOpen: false })}>
              ✕
            </button>
          </header>
          {log.length === 0 ? <p>{t("quests.log.empty")}</p> : null}
          {log.map((v) => card(v))}
        </section>
      ) : null}
    </>
  );
}
