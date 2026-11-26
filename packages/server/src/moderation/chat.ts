import { type BlocklistCategory, moderateChatText } from "@hellovalley/shared";

export type ChatVerdict = { ok: true } | { ok: false; reason: "blocked"; category?: BlocklistCategory; /** Strike weight (shared CATEGORY_STRIKES); 0 or absent: no strike. */ strikes?: number };

export interface ChatModerationContext {
  uid: string;
  /** The language the sender says the line is in (untrusted: every list is checked anyway). */
  lang: string;
}

/**
 * The mandatory server check on every chat line before it is broadcast (GDD §9.3, architecture
 * §6.4, build plan M36: there is no model on the server, so this is the shared normalised
 * blocklist plus link, contact-detail and flood heuristics, `moderateChatText`). The TownRoom adds
 * the rate limits, mute / block lists and the strikes toward shard-wide mutes
 * (safety/moderationService.ts). The sender's and the reader's clients run their own on-device
 * checks too (packages/client/src/ai/moderation.ts).
 */
export function moderateChat(text: string, _context: ChatModerationContext): ChatVerdict {
  const verdict = moderateChatText(text);
  return verdict.ok ? { ok: true } : { ok: false, reason: "blocked", category: verdict.category, strikes: verdict.strikes };
}

export type ChatModerator = typeof moderateChat;
