import { contentKeyMaterial } from "../ai/cacheKey";
import { type Level, levelBand } from "../data/difficulty";
import { itemLabelKey } from "../data/items";
import { getRecipe } from "../data/recipes";
import type { CachedLine } from "../firestore/schemas";
import { ingredientGroupLabelKey } from "../food/recipeCard";
import { BAND_LEVEL, type LevelBand } from "../npc/levels";
import { npcLabelKey } from "../world/labels";
import type { Quest } from "./board";
import { questKindLabelKey } from "./cardWords";
import { getQuestTemplate } from "./templates";

/**
 * The text of a request (build plan M30, GDD §5.5: "written in the target language at the player's
 * level"; npc-runtime.md §9.3). The server never calls a model and only the admin seeding tool
 * writes shared caches (architecture §1, §6.3), so:
 *
 * 1. the seeding tool (`npm run seed:quests`) writes one notice per template × target language ×
 *    level band into `cache/lines/{sha256(questNoticeSeedMaterial)}`, with translations by native
 *    language;
 * 2. on a miss the client generates it once for that player (hybrid task `questNotice`, cloud
 *    first) and keeps it in the player's memory + IndexedDB cache under `questNoticePlayerMaterial`;
 * 3. without either (offline, no AI backend) the request still reads in the target language: the
 *    quest card below is built from world labels only (items, villagers, the kind's verb), like the
 *    M29 recipe cards.
 *
 * The notice never states the reward (it changes with the board's furniture bonus); the UI shows
 * the reward next to it. Level bands are those of the openers: A1, B1 and C1 (npc/levels.ts).
 */

/** Words per notice by level band (my numbers; the prompt's `{{max_words}}`). */
export const QUEST_NOTICE_MAX_WORDS: Readonly<Record<LevelBand, number>> = { A: 25, B: 40, C: 60 };

/** The level a notice is written at for a player level (the band's level). */
export function questNoticeLevel(level: Level): Level {
  return BAND_LEVEL[levelBand(level)];
}

/** Key material of the seeded notice (`cache/lines/{sha256(material)}`). */
export function questNoticeSeedMaterial(templateId: string, targetLang: string, level: Level): string {
  return contentKeyMaterial({ kind: "questNotice", npcId: "mayor", lang: targetLang, level: questNoticeLevel(level), text: templateId });
}

/** Key material of a player's generated notice (their own cache; the native language is in it for the translation). */
export function questNoticePlayerMaterial(templateId: string, targetLang: string, nativeLang: string, level: Level): string {
  return contentKeyMaterial({ kind: "questNotice", npcId: "mayor", lang: `${targetLang}>${nativeLang}`, level: questNoticeLevel(level), text: templateId });
}

/** One line of a notice. */
export interface NoticeLine {
  text: string;
  reading?: string;
  translation: string;
}

export interface QuestNotice {
  title: NoticeLine;
  body: NoticeLine[];
}

/**
 * A seeded `cache/lines` document holds a notice as one line: the title, then the body lines,
 * separated by newlines (the same for `reading` and each translation).
 */
export function noticeToCachedLine(notice: QuestNotice, nativeLang: string): CachedLine {
  const lines = [notice.title, ...notice.body];
  const reading = lines.map((l) => l.reading ?? "").join("\n");
  return {
    text: lines.map((l) => l.text).join("\n"),
    ...(reading.replace(/\n/g, "") ? { reading } : {}),
    translation: { [nativeLang]: lines.map((l) => l.translation).join("\n") },
  };
}

export function noticeFromCachedLine(line: CachedLine, nativeLang: string): QuestNotice | null {
  const texts = line.text.split("\n").map((t) => t.trim());
  if (texts.length < 2 || texts.some((t) => !t)) return null;
  const readings = line.reading?.split("\n") ?? [];
  const translations = line.translation?.[nativeLang]?.split("\n") ?? [];
  const lines = texts.map((text, i): NoticeLine => {
    const reading = readings[i]?.trim();
    return { text, ...(reading && reading !== text ? { reading } : {}), translation: translations[i]?.trim() ?? "" };
  });
  return { title: lines[0]!, body: lines.slice(1) };
}

// ---------------------------------------------------------------------------------------------
// The quest card: the request as world labels (always available, and clickable into the notebook)

export interface QuestCardModel {
  /** The kind's verb ("deliver", "catch"…). */
  verbKey: string;
  /** What, as a label key (an item, a fish, a dish or an "any …" group), and how many. */
  whatKey: string;
  qty: number;
  /** Who asked. */
  fromKey: string;
  /** Who receives it (deliveries and fetches). */
  toKey: string | null;
  /** In-game clock time `HH:MM` (deliveries), else null (today). */
  by: string | null;
}

export function questCard(quest: Pick<Quest, "template">): QuestCardModel {
  const t = getQuestTemplate(quest.template.id) ?? quest.template;
  const target = t.target;
  const base = { verbKey: questKindLabelKey(target.kind), qty: target.qty, fromKey: npcLabelKey(t.giver) };
  switch (target.kind) {
    case "deliver":
      return { ...base, whatKey: itemLabelKey(target.itemId), toKey: npcLabelKey(target.to), by: target.by };
    case "fetch":
      return { ...base, whatKey: itemLabelKey(target.itemId), toKey: npcLabelKey(t.giver), by: null };
    case "catch":
      return { ...base, whatKey: target.fishId ? itemLabelKey(target.fishId) : ingredientGroupLabelKey("fish"), toKey: null, by: null };
    case "cook":
      return { ...base, whatKey: itemLabelKey(getRecipe(target.recipeId)?.result ?? "bread"), toKey: null, by: null };
    case "find":
      return { ...base, whatKey: ingredientGroupLabelKey(target.forageKind), toKey: null, by: null };
  }
}
