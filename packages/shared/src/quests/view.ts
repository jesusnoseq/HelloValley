import type { NpcId } from "../data/npcs";
import type { Quest, QuestSource } from "./board";
import { deadlinePassed, type QuestClock, type QuestLog, questLogFor, type QuestStatus } from "./progress";
import { isHandIn, type QuestReward, type QuestTarget, turnInNpc } from "./templates";

/**
 * Quests as the player is told them (build plan M30: the board panel and the quest log). Server
 * data only; the client writes the notice text itself (quests/notice.ts).
 */
export interface QuestView {
  questId: string;
  templateId: string;
  source: QuestSource;
  giver: NpcId;
  target: QuestTarget;
  reward: QuestReward;
  /** `open`: not taken yet (and still possible); the rest as in the log. */
  status: "open" | QuestStatus;
  progress: number;
  /** Who it is handed to (deliveries and fetches), else null (it completes by itself). */
  turnIn: NpcId | null;
}

export function questView(q: Quest, log: QuestLog, clock: QuestClock): QuestView {
  const e = questLogFor(log, clock.day).entries[q.questId];
  const status: QuestView["status"] = e ? e.status : deadlinePassed(q, clock.minutes) ? "expired" : "open";
  return {
    questId: q.questId,
    templateId: q.template.id,
    source: q.source,
    giver: q.template.giver,
    target: q.template.target,
    reward: q.reward,
    status,
    progress: e?.progress ?? 0,
    turnIn: isHandIn(q.template) ? turnInNpc(q.template) : null,
  };
}

/** The board (today's three requests) and the log (what the player took on today, board or favour). */
export function questViews(quests: readonly Quest[], log: QuestLog, clock: QuestClock): { board: QuestView[]; log: QuestView[] } {
  const current = questLogFor(log, clock.day);
  return {
    board: quests.filter((q) => q.source === "board").map((q) => questView(q, current, clock)),
    log: quests.filter((q) => current.entries[q.questId]).map((q) => questView(q, current, clock)),
  };
}
