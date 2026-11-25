import type { ChatLine } from "../../net/chatSession";

/**
 * Pure view helpers for the chat HUD and the speech bubbles (build plan M18).
 */

/** How long a line stays in its speaker's bubble (my number). */
export const BUBBLE_MS = 7000;
/** The chat bubble floats this far above the name tag's centre (metres). */
export const CHAT_BUBBLE_GAP_M = 0.45;
/** Lines one bubble shows at most (the newest last). */
export const BUBBLE_LINES = 2;

/** Whether a line can be shown: the reader's moderation check is done and passed (or "show anyway"). */
export function lineVisible(line: ChatLine): boolean {
  return line.flagged === false || (line.flagged === true && line.revealed);
}

/** The lines `sessionId`'s bubble shows at client time `now`, oldest first. */
export function bubbleLines(lines: readonly ChatLine[], sessionId: string, now: number): ChatLine[] {
  return lines.filter((l) => l.from === sessionId && lineVisible(l) && now - l.receivedAt < BUBBLE_MS).slice(-BUBBLE_LINES);
}

/** When the next of these lines leaves its bubble (ms from `now`), or null. */
export function nextBubbleExpiry(lines: readonly ChatLine[], now: number): number | null {
  if (lines.length === 0) return null;
  return Math.max(0, Math.min(...lines.map((l) => l.receivedAt + BUBBLE_MS)) - now);
}

/** Whether hovering the line shows anything beyond what is on screen. */
export function hasHover(line: ChatLine): boolean {
  return line.plan.hover !== null;
}
