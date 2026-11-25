import { z } from "zod";
import { contentKeyMaterial } from "../ai/cacheKey";
import { type Level } from "../data/difficulty";
import type { NpcId } from "../data/npcs";
import type { TimeOfDay } from "../data/world";
import { friendshipBand, openerLevelBand, openerTimeBand } from "./levels";
import { NAME_PLACEHOLDER, type OpenerBands } from "./prompt";
import { extractJsonObject, type NpcLine, NpcLineSchema, shortZodError } from "./reply";

/**
 * Cached openers (build plan M21, npc-runtime.md §3, GDD §8.1 step 2). Four openers per
 * NPC × target language × level band × time band × friendship band, generated once with the
 * `npc-opener` template and reused. Because they carry translations and glosses, the native
 * language is part of the key too.
 *
 * Where they are cached (CLAUDE.md, architecture §6.3, §8.3): shared seeded openers in
 * `cache/lines` are written only by the admin seeding tool; a cache miss during play generates
 * them for this player and keeps them in the player's own cache (memory + IndexedDB), never in
 * Firestore.
 */

export const OPENERS_PER_BAND = 4;

export const OpenerSetSchema = z.object({
  openers: z
    .array(NpcLineSchema)
    .min(1)
    .max(OPENERS_PER_BAND * 3)
    .transform((o) => o.slice(0, OPENERS_PER_BAND)),
});
export type OpenerSet = z.output<typeof OpenerSetSchema>;

export function parseOpenerSet(text: string): { ok: true; value: OpenerSet } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = extractJsonObject(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }
  const parsed = OpenerSetSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: shortZodError(parsed.error) };
}

/** The bands of an opener for a player meeting an NPC. */
export function openerBandsFor(input: {
  npcId: NpcId;
  targetLang: string;
  nativeLang: string;
  effectiveLevel: Level;
  timeOfDay: TimeOfDay;
  hearts: number;
}): OpenerBands {
  return {
    npcId: input.npcId,
    targetLang: input.targetLang,
    nativeLang: input.nativeLang,
    level: openerLevelBand(input.effectiveLevel),
    time: openerTimeBand(input.timeOfDay),
    friendship: friendshipBand(input.hearts),
  };
}

/** The content-key material of a band's opener set (hashed by the cache: `sha256(kind, npcId, lang, level, text)`). */
export function openerKeyMaterial(b: OpenerBands): string {
  return contentKeyMaterial({ kind: "opener", npcId: b.npcId, lang: `${b.targetLang}>${b.nativeLang}`, level: b.level, text: `${b.time}|${b.friendship}` });
}

/** Puts the player's name where an opener says {NAME}. */
export function fillOpenerName(line: NpcLine, name: string): NpcLine {
  const sub = (s: string) => s.split(NAME_PLACEHOLDER).join(name);
  return {
    ...line,
    text: sub(line.text),
    translation: sub(line.translation),
    ...(line.reading ? { reading: sub(line.reading) } : {}),
    ...(line.ttsTags ? { ttsTags: sub(line.ttsTags) } : {}),
    tokens: line.tokens.map((t) => ({ ...t, surface: sub(t.surface), ...(t.reading ? { reading: sub(t.reading) } : {}) })),
  };
}

/** One opener of the set, chosen by `random` (0..1). */
export function pickOpener(set: OpenerSet, random: number): NpcLine {
  const i = Math.min(set.openers.length - 1, Math.max(0, Math.floor(random * set.openers.length)));
  return set.openers[i]!;
}
