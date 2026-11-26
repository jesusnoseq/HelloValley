import type { Emote } from "../avatar/animation";
import { type Buff, type BuffKind, getItem, type ItemId } from "../data/items";

/**
 * Timed buffs from eating and drinking (GDD §5.4, build plan M29). Pure: the server keeps each
 * player's set and reads it where a buff matters (walk speed in the movement check, fishing luck
 * in the cast roll, the extra reply hint in the NPC context); the client only shows what the
 * server said (the buff HUD).
 *
 * - One buff per kind: eating the same kind again restarts its timer and keeps the stronger amount
 *   (no stacking, so ten loaves are not +100 % speed).
 * - Instant effects (`durationSec` 0, the cake's happy emote) are not kept: eating plays the emote.
 */

export interface ActiveBuff {
  kind: BuffKind;
  /** As in `Buff`: a fraction for walk_speed and fishing_luck, a count for reply_hint, 0 otherwise. */
  amount: number;
  /** What was eaten (the HUD shows its icon). */
  itemId: ItemId;
  startedMs: number;
  expiresMs: number;
}

/** The emote a happy_emote food plays (my choice of the five emotes). */
export const HAPPY_EMOTE: Emote = "cheer";

/** Caps on what any combination of foods can give (my numbers; the item data stays well under them). */
export const MAX_WALK_SPEED_BONUS = 0.25;
export const MAX_FISHING_LUCK = 0.5;
export const MAX_EXTRA_REPLY_HINTS = 1;

/** The buffs still running at `nowMs` (expired ones dropped). */
export function activeBuffs(buffs: readonly ActiveBuff[], nowMs: number): ActiveBuff[] {
  return buffs.filter((b) => b.expiresMs > nowMs && b.startedMs <= nowMs);
}

/** What eating an item does: a timed buff to add, and/or an emote to play. */
export interface EatEffects {
  buff: Buff | null;
  emote: Emote | null;
}

export function eatEffects(itemId: ItemId): EatEffects {
  const buff = getItem(itemId)?.buff;
  if (!buff) return { buff: null, emote: null };
  if (buff.kind === "happy_emote") return { buff: buff.durationSec > 0 ? buff : null, emote: HAPPY_EMOTE };
  return { buff: buff.durationSec > 0 ? buff : null, emote: null };
}

/**
 * Adds the buff of an eaten item: a running buff of the same kind restarts with the full duration
 * and the larger amount. Expired buffs are dropped on the way.
 */
export function addBuff(buffs: readonly ActiveBuff[], itemId: ItemId, buff: Buff, nowMs: number): ActiveBuff[] {
  const live = activeBuffs(buffs, nowMs);
  if (buff.durationSec <= 0) return live;
  const prev = live.find((b) => b.kind === buff.kind);
  const next: ActiveBuff = {
    kind: buff.kind,
    amount: Math.max(buff.amount, prev?.amount ?? 0),
    itemId: prev && prev.amount > buff.amount ? prev.itemId : itemId,
    startedMs: nowMs,
    expiresMs: nowMs + buff.durationSec * 1000,
  };
  return [...live.filter((b) => b.kind !== buff.kind), next].sort((a, b) => a.kind.localeCompare(b.kind));
}

/** The amount of a buff kind running at `nowMs` (0 without one). */
export function buffAmount(buffs: readonly ActiveBuff[], kind: BuffKind, nowMs: number): number {
  return activeBuffs(buffs, nowMs).find((b) => b.kind === kind)?.amount ?? 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

/** Walking and running speed multiplier (bread: 1.1). The server's movement check uses the same one. */
export function walkSpeedFactor(buffs: readonly ActiveBuff[], nowMs: number): number {
  return 1 + clamp(buffAmount(buffs, "walk_speed", nowMs), 0, MAX_WALK_SPEED_BONUS);
}

/** Fishing luck (fish stew: 0.2), fed into the cast roll (fishing/roll.ts `castTable`). */
export function fishingLuck(buffs: readonly ActiveBuff[], nowMs: number): number {
  return clamp(buffAmount(buffs, "fishing_luck", nowMs), 0, MAX_FISHING_LUCK);
}

/** Extra suggested-reply hints for a conversation started now (coffee: 1). */
export function extraReplyHints(buffs: readonly ActiveBuff[], nowMs: number): number {
  return Math.floor(clamp(buffAmount(buffs, "reply_hint", nowMs), 0, MAX_EXTRA_REPLY_HINTS));
}

export function buffRemainingMs(buff: Pick<ActiveBuff, "expiresMs">, nowMs: number): number {
  return Math.max(0, buff.expiresMs - nowMs);
}
