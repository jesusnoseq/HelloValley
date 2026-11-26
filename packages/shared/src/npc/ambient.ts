import { contentKeyMaterial } from "../ai/cacheKey";
import type { AmbientBarksPromptInput } from "../ai/prompts";
import { getNpc, NPC_RELATIONSHIPS, type NpcActivity, type NpcId } from "../data/npcs";
import type { PlaceId } from "../data/world";
import { NPC_ROLES } from "./prompt";

/**
 * Ambient barks (build plan M31, GDD §8.2–8.3, npc-runtime.md §9.1): short lines a villager says to
 * nobody in particular, and two-line exchanges between villagers with a relationship (the NPC doc).
 * The server only decides *when* a bark happens and which line index (so everyone nearby sees the
 * same moment); each client shows it in its own player's target language:
 *
 * 1. the seeded line `cache/lines/{sha256(material)}`, written only by the admin seeding tool
 *    (`npm run seed:ambient`), with translations by native language;
 * 2. on a miss, the whole set generated once for that player (hybrid task `ambientBarks`, cloud
 *    first), kept in the player's memory + IndexedDB cache, never in Firestore.
 */

/** Ambient barks are written at A2 (npc-runtime.md §9.1). */
export const AMBIENT_LEVEL = "A2";
/** Lines in one villager's set for one activity (the §9.1 prompt asks for 8). */
export const AMBIENT_BARKS_PER_SET = 8;
/** Two-line exchanges per related pair (the §9.1 prompt asks for 3). */
export const AMBIENT_EXCHANGES_PER_PAIR = 3;

/** What the server says happened (`npc:bark`); the client looks up the words. */
export type AmbientBark =
  | { kind: "solo"; npcId: NpcId; activity: NpcActivity; index: number }
  | { kind: "exchange"; a: NpcId; b: NpcId; index: number };

/** The relationship pairs in NPC doc order (the `a` says the first line of an exchange). */
export const BARK_PAIRS: readonly { a: NpcId; b: NpcId }[] = NPC_RELATIONSHIPS.map((r) => ({ a: r.a, b: r.b }));

/** English phrases for the activities, for the prompts (game data). */
export const ACTIVITY_PHRASES: Readonly<Record<NpcActivity, string>> = {
  work: "working",
  eat: "having a bite to eat",
  walk: "taking an evening stroll",
  chat: "visiting and chatting",
  fish: "fishing",
  read: "reading",
  rest: "resting at home",
  sleep: "getting ready for bed",
};

/** Where a villager does an activity (its first schedule point with it), for the prompt. */
export function activityPlace(npcId: NpcId, activity: NpcActivity): PlaceId {
  const npc = getNpc(npcId);
  return npc.schedule.find((p) => p.activity === activity)?.place ?? npc.building;
}

/** The activities a villager's schedule has (one bark set each). */
export function barkActivities(npcId: NpcId): NpcActivity[] {
  return [...new Set(getNpc(npcId).schedule.map((p) => p.activity))];
}

const pairKey = (a: NpcId, b: NpcId) => `${a}+${b}`;

/** Key material of one seeded solo line (`cache/lines/{sha256(material)}`). */
export function soloBarkSeedMaterial(npcId: NpcId, activity: NpcActivity, targetLang: string, index: number): string {
  return contentKeyMaterial({ kind: "ambientBark", npcId, lang: targetLang, level: AMBIENT_LEVEL, text: `${activity}#${index}` });
}

/** Key material of one seeded exchange line (`line` 0 is the first speaker's). */
export function exchangeSeedMaterial(a: NpcId, b: NpcId, targetLang: string, index: number, line: 0 | 1): string {
  return contentKeyMaterial({ kind: "ambientExchange", npcId: pairKey(a, b), lang: targetLang, level: AMBIENT_LEVEL, text: `${index}#${line}` });
}

/** Key material of a player's generated set (their content cache; the native language is in it for the translations). */
export function ambientSetPlayerMaterial(bark: AmbientBark, targetLang: string, nativeLang: string): string {
  return bark.kind === "solo"
    ? contentKeyMaterial({ kind: "ambientBark", npcId: bark.npcId, lang: `${targetLang}>${nativeLang}`, level: AMBIENT_LEVEL, text: bark.activity })
    : contentKeyMaterial({ kind: "ambientExchange", npcId: pairKey(bark.a, bark.b), lang: `${targetLang}>${nativeLang}`, level: AMBIENT_LEVEL, text: "set" });
}

/** The prompt input for a bark's whole set (npc-runtime.md §9.1). */
export function ambientPromptInput(bark: AmbientBark, targetLang: string, nativeLang: string): AmbientBarksPromptInput {
  const speaker = bark.kind === "solo" ? bark.npcId : bark.a;
  const npc = getNpc(speaker);
  const base = { targetLang, nativeLang, npcName: npc.englishName, npcRole: NPC_ROLES[speaker], signature: npc.signature };
  if (bark.kind === "solo") {
    return { ...base, solo: { count: AMBIENT_BARKS_PER_SET, activity: ACTIVITY_PHRASES[bark.activity], location: `the ${activityPlace(bark.npcId, bark.activity).replace(/_/g, " ")}` } };
  }
  const rel = NPC_RELATIONSHIPS.find((r) => r.a === bark.a && r.b === bark.b);
  return { ...base, exchange: { count: AMBIENT_EXCHANGES_PER_PAIR, otherName: getNpc(bark.b).englishName, relationship: rel?.note ?? "neighbours" } };
}

/** The speakers of a bark, in line order. */
export function barkSpeakers(bark: AmbientBark): NpcId[] {
  return bark.kind === "solo" ? [bark.npcId] : [bark.a, bark.b];
}
