import {
  createTokenBucket,
  type InventoryMoveMessage,
  type InventoryStateMessage,
  type RateLimit,
  takeToken,
  type TokenBucket,
} from "@hellovalley/shared";
import type { NpcStore } from "../npc/npcStore";

/**
 * The player's coins and inventory as the server tells the client (build plan M26, GDD §5.6,
 * architecture §6.2). The server is the only writer: coins and items change only through trades
 * the player confirmed (`npc:confirm`), gifts, and slot moves, each in one Admin SDK transaction in
 * the store. A move can only rearrange what the player already holds (shared `moveSlot`), so a
 * forged `inventory:move` gains nothing.
 */

/** Slot moves: a burst of 10, then 5 a second (dragging around the bag quickly is fine). */
export const INVENTORY_MOVE_RATE: RateLimit = { burst: 10, perSecond: 5 };

export class InventoryService {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly store: NpcStore) {}

  /** The current coins and slots, or null when the player has no `langs/{lang}` or the store failed. */
  async state(uid: string, lang: string): Promise<InventoryStateMessage | null> {
    try {
      const wallet = await this.store.wallet(uid, lang);
      return wallet ? { lang, coins: wallet.coins, slots: wallet.slots } : null;
    } catch (err) {
      console.error(`[inventory] loading ${uid}/${lang} failed:`, err);
      return null;
    }
  }

  /** `inventory:move`: the answer always carries the full state (unchanged when refused), or null when nothing could be read. */
  async move(uid: string, lang: string, msg: InventoryMoveMessage, now = Date.now()): Promise<InventoryStateMessage | null> {
    let bucket = this.buckets.get(uid);
    if (!bucket) {
      bucket = createTokenBucket(INVENTORY_MOVE_RATE, now);
      this.buckets.set(uid, bucket);
    }
    if (!takeToken(bucket, INVENTORY_MOVE_RATE, now)) {
      const current = await this.state(uid, lang);
      return current ? { ...current, moveId: msg.moveId, refused: "rate" } : null;
    }
    try {
      const result = await this.store.moveSlot(uid, lang, msg.from, msg.to);
      if (!result) return null;
      return { lang, coins: result.coins, slots: result.slots, moveId: msg.moveId, ...(result.ok ? {} : { refused: result.reason }) };
    } catch (err) {
      console.error(`[inventory] a move for ${uid}/${lang} failed:`, err);
      const current = await this.state(uid, lang);
      return current ? { ...current, moveId: msg.moveId, refused: "unavailable" } : null;
    }
  }

  /** The player left: drop their rate bucket. */
  forget(uid: string): void {
    this.buckets.delete(uid);
  }
}
