import {
  dailySpawns,
  type ForageAlbumMessage,
  type ForagePickRefusal,
  type ForageResultMessage,
  type ForageSpawn,
  itemCounts,
  type ItemId,
  judgePick,
  type LostItemHint,
  lostItemHints,
  type LostItemId,
  type NpcId,
  type NpcReturnedMessage,
  PICK_COOLDOWN_MS,
  type SlotEntry,
  type SpaceId,
  type Vec2,
  worldDayAt,
} from "@hellovalley/shared";
import type { ForageStore } from "./forageStore";

/**
 * Foraging on the server (build plan M28, GDD §5.3, architecture §3.1 and §6.1). Each shard has
 * its own daily spawns, a pure function of (shard, in-game day) (shared `dailySpawns`), so a
 * restart recomputes the same set; only which ones were picked lives here, and a new in-game day
 * starts over with a fresh set. A pick-up (`forage:pick`) is checked against the server's own
 * walker position (in town, within PICK_RADIUS_M + slack), the spawn's day and whether someone
 * already took it; the item and the album entry land in one store transaction. Returning a lost
 * item (`npc:return`, in a conversation with its owner) goes through the shared friendship rule.
 *
 * Picked spawns are kept per shard number, not per room, so emptying a shard and reopening it
 * does not respawn what was picked. They are kept in memory: a server restart puts the day's
 * remaining *and* picked spawns back (pending.md §M28).
 */

/** Where the player is, from the room's own records. */
export interface ForageWhere {
  space: SpaceId;
  pos: Vec2;
  talking: boolean;
}

export interface ForageServiceOptions {
  /** The clock (tests advance a fake one). */
  now?: () => number;
}

interface ShardDay {
  day: number;
  spawns: Map<string, ForageSpawn>;
  /** Picked, or being picked right now (a second picker is refused before any await). */
  gone: Set<string>;
}

export type ReturnResult = { ok: true; returned: NpcReturnedMessage } | { ok: false; reason: "unavailable" };

const entries = (slots: readonly SlotEntry[]) =>
  Object.entries(itemCounts(slots)).map(([itemId, qty]) => ({ itemId: itemId as ItemId, qty: qty ?? 0 }));

export class ForageService {
  private readonly shards = new Map<number, ShardDay>();
  private readonly lastPick = new Map<string, number>();
  readonly now: () => number;

  constructor(
    private readonly store: ForageStore,
    options: ForageServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** The shard's spawns for the current in-game day (a new day replaces yesterday's). */
  private shardDay(shard: number): ShardDay {
    const day = worldDayAt(this.now());
    let s = this.shards.get(shard);
    if (!s || s.day !== day) {
      s = { day, spawns: new Map(dailySpawns(shard, day).map((sp) => [sp.spawnId, sp])), gone: new Set() };
      this.shards.set(shard, s);
    }
    return s;
  }

  /** The in-game day and the spawns still lying in the shard (what the room syncs). */
  open(shard: number): { day: number; spawns: ForageSpawn[] } {
    const s = this.shardDay(shard);
    return { day: s.day, spawns: [...s.spawns.values()].filter((sp) => !s.gone.has(sp.spawnId)) };
  }

  /** The Gossip's hints for this shard: the lost items nobody has picked up yet today. */
  hints(shard: number): LostItemHint[] {
    return lostItemHints(this.open(shard).spawns);
  }

  async pick(uid: string, lang: string, shard: number, spawnId: string, where: ForageWhere): Promise<ForageResultMessage> {
    const refuse = (reason: ForagePickRefusal): ForageResultMessage => ({ spawnId, ok: false, reason });
    const now = this.now();
    if (now - (this.lastPick.get(uid) ?? Number.NEGATIVE_INFINITY) < PICK_COOLDOWN_MS) return refuse("cooldown");
    if (where.talking) return refuse("talking");
    const s = this.shardDay(shard);
    const spawn = s.spawns.get(spawnId);
    const verdict = judgePick(spawn, s.gone.has(spawnId), where.space, where.pos);
    if (!verdict.ok) return refuse(verdict.reason);
    this.lastPick.set(uid, now);
    s.gone.add(spawnId);
    let outcome;
    try {
      outcome = await this.store.recordFind(uid, lang, spawn!.itemId, now);
    } catch (err) {
      console.error(`[forage] saving a find for ${uid}/${lang} failed:`, err);
      outcome = null;
    }
    if (!outcome?.ok) {
      // Nothing was taken: the spawn stays for this player (with room in the bag) or someone else.
      s.gone.delete(spawnId);
      return refuse(outcome ? outcome.reason : "unavailable");
    }
    return { spawnId, ok: true, itemId: spawn!.itemId, kind: spawn!.kind, first: outcome.first, entry: outcome.entry };
  }

  /** `npc:return`: the lost item goes back to `npcId` (the room checked the conversation). */
  async returnLost(uid: string, lang: string, conversationId: string, npcId: NpcId, itemId: LostItemId): Promise<ReturnResult> {
    let outcome;
    try {
      outcome = await this.store.returnLost(uid, lang, npcId, itemId, worldDayAt(this.now()));
    } catch (err) {
      console.error(`[forage] returning ${itemId} for ${uid}/${lang} failed:`, err);
      return { ok: false, reason: "unavailable" };
    }
    if (!outcome) return { ok: false, reason: "unavailable" };
    const returned: NpcReturnedMessage = outcome.ok
      ? { conversationId, itemId, ok: true, delta: outcome.delta, hearts: outcome.hearts, inventory: entries(outcome.slots) }
      : { conversationId, itemId, ok: false, reason: outcome.reason, delta: 0, hearts: outcome.hearts, inventory: entries(outcome.slots) };
    return { ok: true, returned };
  }

  /** The album for `forage:album`, or null when it could not be read. */
  async album(uid: string): Promise<ForageAlbumMessage | null> {
    try {
      return { album: await this.store.album(uid) };
    } catch (err) {
      console.error(`[forage] reading the album of ${uid} failed:`, err);
      return null;
    }
  }

  /** The player left the server: forget their pacing. */
  forget(uid: string): void {
    this.lastPick.delete(uid);
  }
}
