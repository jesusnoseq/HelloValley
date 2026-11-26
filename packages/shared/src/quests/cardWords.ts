import type { QuestKind } from "./templates";

/**
 * The fixed words of a quest card (build plan M30, quests/notice.ts) as world-label keys with
 * their English source words. Kept apart from notice.ts so the label registry can merge them
 * without an import cycle.
 */
export const QUEST_CARD_WORDS: Readonly<Record<string, string>> = {
  "quest.notice": "notice",
  "quest.reward": "reward",
  "quest.before": "before",
  "quest.today": "today",
  "quest.kind.deliver": "deliver",
  "quest.kind.fetch": "bring",
  "quest.kind.catch": "catch",
  "quest.kind.cook": "cook",
  "quest.kind.find": "find",
};

/** The kind's verb ("deliver", "catch"…) as a label key. */
export const questKindLabelKey = (kind: QuestKind) => `quest.kind.${kind}`;

/** Every quest-card label key with its English word (merged into the world label registry). */
export function questCardLabels(): Record<string, string> {
  return { ...QUEST_CARD_WORDS };
}
