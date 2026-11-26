import {
  CachedLineSchema,
  getQuestTemplate,
  type Level,
  levelBand,
  noticeFromCachedLine,
  QUEST_NOTICE_MAX_WORDS,
  type QuestNotice,
  type QuestNoticeResponse,
  questFacts,
  questNoticeLevel,
  questNoticeSeedMaterial,
} from "@hellovalley/shared";
import type { TaskResult } from "./hybrid";

/**
 * A request's notice in the target language (build plan M30, GDD §5.5, npc-runtime.md §9.3),
 * looked up like every piece of shared content (CLAUDE.md, architecture §6.3):
 *
 * 1. the seeded notice in `cache/lines/{sha256(questNoticeSeedMaterial)}` (template × target
 *    language × level band), written only by the admin seeding tool (`npm run seed:quests`),
 *    with its translation into the player's language;
 * 2. on a miss, generated once for this player (hybrid `questNotice`, cloud first), which the
 *    hybrid module keeps in the player's memory + IndexedDB cache, never in Firestore.
 *
 * Without either (offline, no AI backend) the caller shows the quest card (world labels only).
 */

export interface QuestNoticeDeps {
  /** The seeded `cache/lines` document for a key material, or null. Never throws. */
  seeded?: (material: string) => Promise<unknown>;
  generate: (input: { templateId: string; targetLang: string; nativeLang: string; level: Level; maxWords: number; facts: Record<string, string | number | undefined> }) => Promise<TaskResult<QuestNoticeResponse>>;
}

export interface QuestNotices {
  get(input: { templateId: string; targetLang: string; nativeLang: string; level: Level }): Promise<QuestNotice | null>;
}

export function createQuestNotices(deps: QuestNoticeDeps): QuestNotices {
  return {
    async get({ templateId, targetLang, nativeLang, level }) {
      const template = getQuestTemplate(templateId);
      if (!template) return null;
      if (deps.seeded) {
        const raw = await deps.seeded(questNoticeSeedMaterial(templateId, targetLang, level)).catch(() => null);
        const parsed = CachedLineSchema.safeParse(raw);
        const notice = raw && parsed.success ? noticeFromCachedLine(parsed.data, nativeLang) : null;
        if (notice) return notice;
      }
      const generated = await deps
        .generate({ templateId, targetLang, nativeLang, level: questNoticeLevel(level), maxWords: QUEST_NOTICE_MAX_WORDS[levelBand(level)], facts: { ...questFacts(template) } })
        .catch(() => null);
      return generated?.ok ? generated.value : null;
    },
  };
}
