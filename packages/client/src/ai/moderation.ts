/**
 * Client-side chat moderation hooks (GDD §9.3, architecture §6.4, build plan M18). There is no
 * model on the server, so moderation is split three ways: the game server's mandatory check
 * (blocklist, rate limits, mute / block / report) always runs; the sender's client checks a line
 * before sending (a soft "are you sure?"); the reader's client checks a line before showing it
 * (flagged lines are collapsed with "show anyway").
 *
 * TODO(M20): the real `moderate` task in `ai/hybrid.ts`: sender side `PREFER_ON_DEVICE`, reader
 * side `ONLY_ON_DEVICE`, both falling back to "server blocklist only" (= not flagged here); one
 * single-turn prompt with the text as quoted `<player_text>` data and a small zod-validated JSON
 * answer. Until then nothing is flagged.
 */

export type ModerationVerdict = { flagged: false } | { flagged: true; reason?: string };

export interface ChatModeration {
  /** Before sending: a flagged line asks the sender to confirm. */
  checkOutgoing(text: string, lang: string): Promise<ModerationVerdict>;
  /** Before showing: a flagged line is collapsed until the reader chooses to see it. */
  checkIncoming(text: string, lang: string): Promise<ModerationVerdict>;
}

const NOT_FLAGGED: ModerationVerdict = { flagged: false };

/** The stand-in until M20: the fallback (server blocklist only) for every line. */
export const stubChatModeration: ChatModeration = {
  checkOutgoing: () => Promise.resolve(NOT_FLAGGED),
  checkIncoming: () => Promise.resolve(NOT_FLAGGED),
};
