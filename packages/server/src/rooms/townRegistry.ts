import type { ShardInfo, UserProfile } from "@hellovalley/shared";

/** What the registry needs from a live TownRoom. */
export interface RegisteredTown {
  readonly roomId: string;
  readonly shard: number;
  readonly clientCount: number;
  readonly maxClientCount: number;
  /** Disconnects one session because a newer session of the same uid joined. */
  replaceSession(sessionId: string): void;
  /** Shows a new name or look for every session of `uid` in this room. */
  applyProfile(uid: string, profile: UserProfile): void;
}

interface SessionEntry {
  town: RegisteredTown;
  sessionId: string;
}

/**
 * Process-wide bookkeeping for the TownRoom shards (architecture §7.1: one server instance, so an
 * in-memory map is enough): shard numbers ("Valley #1, #2…", the lowest free number for each new
 * shard), the uid → session map behind "join a friend" and one-session-per-uid, and the profile
 * push after a mirror save. One registry per game server, so tests are isolated.
 */
export class TownRegistry {
  private readonly towns = new Map<string, RegisteredTown>();
  private readonly shardsInUse = new Set<number>();
  private readonly sessions = new Map<string, SessionEntry>();

  /** The lowest shard number not in use. Call `releaseShard` when the room disposes. */
  claimShard(): number {
    let n = 1;
    while (this.shardsInUse.has(n)) n++;
    this.shardsInUse.add(n);
    return n;
  }

  releaseShard(shard: number): void {
    this.shardsInUse.delete(shard);
  }

  addTown(town: RegisteredTown): void {
    this.towns.set(town.roomId, town);
  }

  removeTown(town: RegisteredTown): void {
    this.towns.delete(town.roomId);
    for (const [uid, entry] of this.sessions) if (entry.town === town) this.sessions.delete(uid);
  }

  /**
   * Records that `uid` now plays in `town` as `sessionId`. An older session of the same uid (an
   * old tab, any shard) is disconnected: the newest session wins.
   */
  bindSession(uid: string, town: RegisteredTown, sessionId: string): void {
    const previous = this.sessions.get(uid);
    this.sessions.set(uid, { town, sessionId });
    if (previous && (previous.town !== town || previous.sessionId !== sessionId)) previous.town.replaceSession(previous.sessionId);
  }

  /** Forgets `uid` if `sessionId` is still its current session. */
  unbindSession(uid: string, sessionId: string): void {
    if (this.sessions.get(uid)?.sessionId === sessionId) this.sessions.delete(uid);
  }

  /** The TownRoom session id `uid` currently plays as, or null. */
  sessionIdOf(uid: string): string | null {
    return this.sessions.get(uid)?.sessionId ?? null;
  }

  /** Whether `sessionId` is the current session of `uid`. */
  isCurrent(uid: string, sessionId: string): boolean {
    return this.sessions.get(uid)?.sessionId === sessionId;
  }

  /** The shard `uid` is playing in, or null. */
  shardOf(uid: string): ShardInfo | null {
    const entry = this.sessions.get(uid);
    return entry && this.towns.has(entry.town.roomId) ? infoOf(entry.town) : null;
  }

  /** Every live shard, lowest number first. */
  list(): ShardInfo[] {
    return [...this.towns.values()].map(infoOf).sort((a, b) => a.shard - b.shard);
  }

  /** Pushes a saved profile (name, look) to the room `uid` plays in. */
  applyProfile(uid: string, profile: UserProfile): void {
    this.sessions.get(uid)?.town.applyProfile(uid, profile);
  }
}

function infoOf(town: RegisteredTown): ShardInfo {
  return { roomId: town.roomId, shard: town.shard, clients: town.clientCount, maxClients: town.maxClientCount };
}
