/**
 * Client-side chat moderation hooks (GDD §9.3, architecture §6.4, build plan M18). There is no
 * model on the server, so moderation is split three ways: the game server's mandatory check
 * (blocklist, rate limits, mute / block / report) always runs; the sender's client checks a line
 * before sending (a soft "are you sure?"); the reader's client checks a line before showing it
 * (flagged lines are collapsed with "show anyway").
 *
 * Build plan M20: `hybridModeration` runs the hybrid `moderate` task: sender side
 * `PREFER_ON_DEVICE`, reader side `ONLY_ON_DEVICE`, both falling back to "server blocklist only"
 * (= not flagged here); one single-turn prompt with the text as quoted `<player_text>` data and a
 * small zod-validated JSON answer.
 */
import type { HybridAI } from "./hybrid";

export type ModerationVerdict = { flagged: false } | { flagged: true; reason?: string };

export interface ChatModeration {
  /** Before sending: a flagged line asks the sender to confirm. */
  checkOutgoing(text: string, lang: string): Promise<ModerationVerdict>;
  /** Before showing: a flagged line is collapsed until the reader chooses to see it. */
  checkIncoming(text: string, lang: string): Promise<ModerationVerdict>;
}

const NOT_FLAGGED: ModerationVerdict = { flagged: false };

/** The fallback (server blocklist only) for every line: tests, and pages without the AI module. */
export const stubChatModeration: ChatModeration = {
  checkOutgoing: () => Promise.resolve(NOT_FLAGGED),
  checkIncoming: () => Promise.resolve(NOT_FLAGGED),
};

/** Chat moderation over the hybrid module. No verdict (no model, invalid answers) = not flagged. */
export function hybridModeration(ai: Pick<HybridAI, "moderate">): ChatModeration {
  const check = async (text: string, side: "sender" | "reader"): Promise<ModerationVerdict> => {
    const r = await ai.moderate({ text, side }).catch(() => null);
    if (!r?.ok || r.value.ok) return NOT_FLAGGED;
    return r.value.category ? { flagged: true, reason: r.value.category } : { flagged: true };
  };
  return {
    checkOutgoing: (text) => check(text, "sender"),
    checkIncoming: (text) => check(text, "reader"),
  };
}
