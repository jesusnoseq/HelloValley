export type ChatVerdict = { ok: true } | { ok: false; reason: "blocked" };

export interface ChatModerationContext {
  uid: string;
  /** The language the sender says the line is in. */
  lang: string;
}

/**
 * The mandatory server check on every chat line before it is broadcast (GDD §9.3, architecture
 * §6.4: there is no model on the server, so this is a blocklist plus the rate limits and the
 * mute / block lists the TownRoom applies). The sender's and the reader's clients run their own
 * on-device checks too (packages/client/src/ai/moderation.ts).
 * TODO(M36): the real check: a normalised per-language blocklist (case, accents, leetspeak,
 * spacing, scripts), links and personal data (emails, phone numbers), and strikes toward
 * shard-wide mutes for repeat offenders. Until then every schema-valid line is accepted.
 */
export function moderateChat(_text: string, _context: ChatModerationContext): ChatVerdict {
  return { ok: true };
}

export type ChatModerator = typeof moderateChat;
