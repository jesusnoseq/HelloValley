import { randomUUID } from "node:crypto";
import {
  buildDigest,
  emptyDigest,
  eventDedupeKey,
  LEGEND_WINDOW_MS,
  notability,
  type NpcId,
  VILLAGE_BATCH_MS,
  VILLAGE_EVENTS_PER_PLAYER_DAY,
  VILLAGE_LOG_MAX,
  type VillageDigest,
  type VillageEventInput,
  type VillageEventRecord,
  villageNewsFor,
  villageShardId,
  worldDayAt,
} from "@hellovalley/shared";
import type { VillageStore } from "./villageStore";

export interface VillageServiceOptions {
  /** The clock (tests fix it). */
  now?: () => number;
}

interface ShardLog {
  events: VillageEventRecord[];
  /** The last good batch (GDD §9.2 fallback "last good batch"). */
  digest: VillageDigest;
  /** The stored log was read once after a (re)start. */
  loaded: Promise<void> | null;
}

/**
 * Shared village memory on the game server (build plan M31, GDD §8.2), shared by every shard:
 *
 * - `log`: a public game event of a player (a rare catch, a rare find, a returned lost item, a
 *   finished request), with their name only when they allow it, capped per player and in-game day
 *   and deduplicated, kept in memory per shard and written to `village/{shardId}/events`;
 * - `runBatch` (every VILLAGE_BATCH_MS, from the rooms' world tick through `maybeBatch`): turns each
 *   shard's log into the Gossip's rumours and the Elder's legends (shared `buildDigest`; no model,
 *   see village/events.ts for the architecture mapping). A shard's stored log is read back once
 *   after a restart. A failing read keeps the last good digest;
 * - `news`: what the Gossip or the Elder knows in a shard (`npc:context.news`).
 */
export class VillageService {
  private readonly shards = new Map<number, ShardLog>();
  private readonly named = new Map<string, boolean>();
  /** `${uid}|${day}` → events logged; dedupe keys of today. */
  private readonly counts = new Map<string, number>();
  private readonly seen = new Set<string>();
  private lastBatch = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;

  constructor(
    private readonly store: VillageStore,
    options: VillageServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  private shard(shard: number): ShardLog {
    let s = this.shards.get(shard);
    if (!s) {
      s = { events: [], digest: emptyDigest(), loaded: null };
      this.shards.set(shard, s);
    }
    return s;
  }

  /** Reads the shard's stored log once (after a restart the batch starts from it). */
  private load(shard: number): Promise<void> {
    const s = this.shard(shard);
    s.loaded ??= this.store
      .recent(villageShardId(shard), this.now() - LEGEND_WINDOW_MS, VILLAGE_LOG_MAX)
      .then((stored) => {
        const ids = new Set(s.events.map((e) => e.id));
        s.events = [...s.events, ...stored.filter((e) => !ids.has(e.id))].sort((a, b) => b.ts - a.ts).slice(0, VILLAGE_LOG_MAX);
      })
      .catch((err: unknown) => {
        console.error(`[village] reading the log of shard ${shard} failed:`, err);
        s.loaded = null;
      });
    return s.loaded;
  }

  /** A room for this shard opened: read its log and make a first digest. */
  async open(shard: number): Promise<void> {
    await this.load(shard);
    const s = this.shard(shard);
    if (s.digest.at === 0) s.digest = buildDigest(s.events, this.now(), this.globalNotable(shard));
  }

  /** Whether village news may use this player's name (default: yes, GDD §8.2 opt-out). */
  async isNamed(uid: string): Promise<boolean> {
    const hit = this.named.get(uid);
    if (hit !== undefined) return hit;
    try {
      const stored = await this.store.privacy(uid);
      const named = stored ?? true;
      this.named.set(uid, named);
      return named;
    } catch (err) {
      console.error(`[village] reading the privacy of ${uid} failed:`, err);
      // Unknown: keep them anonymous rather than name them against their wish.
      return false;
    }
  }

  async setNamed(uid: string, named: boolean): Promise<boolean> {
    await this.store.setPrivacy(uid, named);
    this.named.set(uid, named);
    return named;
  }

  /** Logs a public event; returns the record, or null when it was capped or a duplicate. */
  async log(shard: number, actor: { uid: string; name: string }, input: VillageEventInput): Promise<VillageEventRecord | null> {
    const now = this.now();
    const day = worldDayAt(now);
    const dedupe = eventDedupeKey(actor.uid, input, day);
    const countKey = `${actor.uid}|${day}`;
    const count = this.counts.get(countKey) ?? 0;
    if (this.seen.has(dedupe) || count >= VILLAGE_EVENTS_PER_PLAYER_DAY) return null;
    this.seen.add(dedupe);
    this.counts.set(countKey, count + 1);
    const named = await this.isNamed(actor.uid);
    const record = { id: randomUUID(), ...input, ...(named ? { actorName: actor.name } : {}), ts: now } as VillageEventRecord;
    const s = this.shard(shard);
    s.events = [record, ...s.events].slice(0, VILLAGE_LOG_MAX);
    try {
      await this.store.append(villageShardId(shard), record);
    } catch (err) {
      // The in-memory log still has it until a restart.
      console.error(`[village] storing an event in shard ${shard} failed:`, err);
    }
    return record;
  }

  /** Notable events of the other shards, for the Elder's legends ("per shard and globally", GDD §8.2). */
  private globalNotable(except: number): VillageEventRecord[] {
    const out: VillageEventRecord[] = [];
    for (const [n, s] of this.shards) if (n !== except) out.push(...s.events.filter((e) => notability(e) >= 3));
    return out;
  }

  /** The batch: a fresh digest per shard. A shard whose log cannot be read keeps its last good one. */
  async runBatch(): Promise<void> {
    const now = this.now();
    this.lastBatch = now;
    for (const shard of [...this.shards.keys()]) {
      try {
        await this.load(shard);
        const s = this.shard(shard);
        s.digest = buildDigest(s.events, now, this.globalNotable(shard));
      } catch (err) {
        console.error(`[village] batch for shard ${shard} failed:`, err);
      }
    }
    // Yesterday's caps and dedupe keys are no longer needed.
    const today = worldDayAt(now);
    for (const key of [...this.counts.keys()]) if (Number(key.split("|")[1]) < today) this.counts.delete(key);
    for (const key of [...this.seen]) if (Number(key.split("|")[1]) < today) this.seen.delete(key);
  }

  /** Runs the batch when VILLAGE_BATCH_MS have passed (called from the rooms' 1 s world tick). */
  maybeBatch(): void {
    if (this.now() - this.lastBatch < VILLAGE_BATCH_MS) return;
    this.lastBatch = this.now();
    void this.runBatch();
  }

  /** What `npcId` knows in this shard (the last batch). */
  news(shard: number, npcId: NpcId): string[] {
    return villageNewsFor(npcId, this.shards.get(shard)?.digest ?? emptyDigest());
  }

  /** The shard's log, newest first (tests, debugging). */
  events(shard: number): readonly VillageEventRecord[] {
    return this.shards.get(shard)?.events ?? [];
  }

  forget(uid: string): void {
    this.named.delete(uid);
  }
}
