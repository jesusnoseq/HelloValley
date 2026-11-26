import { z } from "zod";
import { getFish } from "../data/fish";
import { getForage } from "../data/forage";
import { getLostItem as lostItemDef } from "../forage/lost";
import { getNpc, NpcIdSchema, type NpcId } from "../data/npcs";
import { RARITIES, type Rarity } from "../data/rarity";
import { PLACE_IDS, type PlaceId } from "../data/world";
import { parseQuestId } from "../quests/board";
import { getQuestTemplate, QUEST_KINDS, type QuestKind } from "../quests/templates";
import { worldDayAt } from "../world/clock";
import { townPlaces, type Vec2 } from "../world/town";

/**
 * Shared village memory (build plan M31, GDD §8.2): a rolling log of *public game events* per
 * shard (never chat or anything private), and the periodic batch that turns the log into what the
 * Gossip and the Elder know.
 *
 * Architecture §1/§5.2/§11 override the build plan's "cloud batch": the game server never calls a
 * model. So the batch here is deterministic: it picks the newsworthy events and writes each as a
 * short English seed (npc-runtime.md §8.1: "the English text is a seed"). The model's part runs in
 * the Gossip's and the Elder's own turns (cloud, `npc-turn` template): the Gossip retells a seed as
 * a (slightly exaggerated) rumour, the Elder as a legend (§8.2), in the player's target language
 * and level, with the instructions of those two prompts in the template.
 *
 * Names: an event carries the player's display name only if they did not opt out (`named`,
 * `users/{uid}/privacy/village`); otherwise it says "someone" (§8.1), and the Elder's legends
 * keep only consenting names (§8.2) — the same rule, because only consenting names are stored.
 */

export const VILLAGE_EVENT_TYPES = ["fish_caught", "forage_found", "lost_returned", "request_done"] as const;
export type VillageEventType = (typeof VILLAGE_EVENT_TYPES)[number];
export const VillageEventTypeSchema = z.enum(VILLAGE_EVENT_TYPES);

const RaritySchema = z.enum(RARITIES);
const PlaceSchema = z.enum(PLACE_IDS);

/** Payload of each event type (game data only). */
export const VillageEventPayloadSchemas = {
  fish_caught: z.strictObject({ fishId: z.string().min(1).max(64), rarity: RaritySchema, place: PlaceSchema }),
  forage_found: z.strictObject({ itemId: z.string().min(1).max(64), rarity: RaritySchema, place: PlaceSchema }),
  lost_returned: z.strictObject({ itemId: z.string().min(1).max(64), owner: NpcIdSchema }),
  request_done: z.strictObject({ templateId: z.string().min(1).max(64), kind: z.enum(QUEST_KINDS), npcId: NpcIdSchema }),
} as const satisfies Record<VillageEventType, z.ZodType>;

export type VillageEventPayload<T extends VillageEventType = VillageEventType> = z.infer<(typeof VillageEventPayloadSchemas)[T]>;

/** One logged event as the server keeps it (Firestore `village/{shardId}/events/{id}` has the same fields, `ts` as a Timestamp). */
export type VillageEventRecord = {
  [T in VillageEventType]: { id: string; type: T; actorName?: string; payload: VillageEventPayload<T>; ts: number };
}[VillageEventType];

/** What a game event logs (the server adds the id, the time and the name if the player allows it). */
export type VillageEventInput = { [T in VillageEventType]: { type: T; payload: VillageEventPayload<T> } }[VillageEventType];

/** Parses a stored payload against its type (a corrupt one is skipped by the reader). */
export function parseVillagePayload(type: string, payload: unknown): VillageEventInput | null {
  const t = VillageEventTypeSchema.safeParse(type);
  if (!t.success) return null;
  const p = VillageEventPayloadSchemas[t.data].safeParse(payload);
  return p.success ? ({ type: t.data, payload: p.data } as VillageEventInput) : null;
}

/** Firestore id of a shard's village log (`village/{shardId}`). */
export const villageShardId = (shard: number) => `valley-${shard}`;

/** Only rarer finds make news (my choice: common and uncommon catches are everyday life). */
export const NEWSWORTHY_RARITIES: readonly Rarity[] = ["rare", "legendary"];
export const isNewsworthyRarity = (r: Rarity) => NEWSWORTHY_RARITIES.includes(r);

/** At most this many events per player per in-game day (my number: one player cannot flood the log). */
export const VILLAGE_EVENTS_PER_PLAYER_DAY = 6;
/** Events the server keeps in memory per shard (newest). */
export const VILLAGE_LOG_MAX = 60;
/** The batch runs this often (ms): every 2 in-game hours (one in-game day is 40 minutes). */
export const VILLAGE_BATCH_MS = 200_000;
/** Rumours come from the last this-many in-game days of events. */
export const RUMOUR_DAYS = 3;
/** The Gossip knows at most this many rumours (npc-runtime.md §8.1 asks for 5). */
export const RUMOURS_MAX = 5;
/** The Elder knows at most this many legends (npc-runtime.md §8.2 asks for 2). */
export const LEGENDS_MAX = 2;
/** Legends come from notable events of the past this-many real days (the event TTL, GDD §9.4). */
export const LEGEND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** The nearest named place to a town point (events say "at the fishing dock"). */
export function nearestPlace(pos: Vec2): PlaceId {
  const places = townPlaces();
  let best: PlaceId = "town_square";
  let bestD = Infinity;
  for (const id of PLACE_IDS) {
    const p = places[id];
    const d = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

const placeName = (p: PlaceId) => `the ${p.replace(/_/g, " ")}`;
const lower = (s: string) => s.toLowerCase();

/** When it happened, from the in-game days between the event and now. */
function when(ts: number, now: number): string {
  const days = worldDayAt(now) - worldDayAt(ts);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const QUEST_VERBS: Readonly<Record<QuestKind, string>> = {
  deliver: "made a delivery for",
  fetch: "fetched something for",
  catch: "caught fish for",
  cook: "cooked for",
  find: "foraged for",
};

/** One event as an English seed (data for the prompt, not instructions). */
export function newsSeed(e: VillageEventRecord, now: number): string {
  const who = e.actorName ?? "someone";
  const t = when(e.ts, now);
  switch (e.type) {
    case "fish_caught": {
      const fish = getFish(e.payload.fishId);
      return `${who} caught a ${e.payload.rarity} ${lower(fish?.englishName ?? "fish")} at ${placeName(e.payload.place)} (${t}).`;
    }
    case "forage_found": {
      const item = getForage(e.payload.itemId);
      return `${who} found a ${e.payload.rarity} ${lower(item?.englishName ?? "treasure")} near ${placeName(e.payload.place)} (${t}).`;
    }
    case "lost_returned": {
      const item = lostItemDef(e.payload.itemId);
      return `${who} found the ${getNpc(e.payload.owner).englishName}'s lost ${lower(item?.englishName ?? "thing")} and gave it back (${t}).`;
    }
    case "request_done":
      return `${who} ${QUEST_VERBS[e.payload.kind]} the ${getNpc(e.payload.npcId).englishName} (${t}).`;
  }
}

/** How much a village would talk about an event (my weights). */
export function notability(e: VillageEventRecord): number {
  switch (e.type) {
    case "fish_caught":
    case "forage_found":
      return e.payload.rarity === "legendary" ? 4 : e.payload.rarity === "rare" ? 3 : 1;
    case "lost_returned":
      return 2;
    case "request_done":
      return 1;
  }
}

/** What the batch hands the Gossip and the Elder (English seeds). */
export interface VillageDigest {
  rumours: string[];
  legends: string[];
  /** When the batch ran (ms). */
  at: number;
}

export const emptyDigest = (at = 0): VillageDigest => ({ rumours: [], legends: [], at });

/**
 * The batch (build plan M31): the Gossip's rumours (the most talked-about events of the last
 * RUMOUR_DAYS in-game days, newest first) and the Elder's legends (the most notable events of the
 * last two weeks, rare and legendary finds only).
 */
export function buildDigest(events: readonly VillageEventRecord[], now: number, globalNotable: readonly VillageEventRecord[] = []): VillageDigest {
  const recent = events.filter((e) => e.ts <= now && worldDayAt(now) - worldDayAt(e.ts) < RUMOUR_DAYS);
  const rumours = [...recent]
    .sort((a, b) => notability(b) - notability(a) || b.ts - a.ts)
    .slice(0, RUMOURS_MAX)
    .sort((a, b) => b.ts - a.ts)
    .map((e) => newsSeed(e, now));
  const seen = new Set<string>();
  const legends = [...events, ...globalNotable]
    .filter((e) => {
      if (seen.has(e.id) || e.ts > now || now - e.ts > LEGEND_WINDOW_MS || notability(e) < 3) return false;
      seen.add(e.id);
      return true;
    })
    .sort((a, b) => notability(b) - notability(a) || b.ts - a.ts)
    .slice(0, LEGENDS_MAX)
    .map((e) => `Legend seed: ${newsSeed(e, now)}`);
  return { rumours, legends, at: now };
}

/** The `news` of an NPC's context: rumours for the Gossip, legends for the Elder, nothing for the others. */
export function villageNewsFor(npcId: NpcId, digest: VillageDigest): string[] {
  if (npcId === "gossip") return digest.rumours;
  if (npcId === "elder") return digest.legends;
  return [];
}

/** A dedupe key: the same player logging the same thing twice in one in-game day counts once. */
export function eventDedupeKey(uid: string, e: VillageEventInput, day: number): string {
  return `${uid}|${day}|${e.type}|${JSON.stringify(e.payload)}`;
}

/** `request_done` for a completed quest id, or null when the id is not a catalog request. */
export function requestDoneEvent(questId: string): VillageEventInput | null {
  const parsed = parseQuestId(questId);
  const t = parsed ? getQuestTemplate(parsed.templateId) : undefined;
  if (!t) return null;
  return { type: "request_done", payload: { templateId: t.id, kind: t.target.kind, npcId: t.giver } };
}
