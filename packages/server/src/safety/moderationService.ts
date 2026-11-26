import { addStrike, emptyStanding, type ModerationStanding, mutedUntil, type Strike, type StrikeOutcome } from "@hellovalley/shared";
import type { ServerMetrics } from "../metrics/metrics";
import type { SafetyStore } from "./safetyStore";

/**
 * Strikes and shard-wide mutes for repeat offenders (GDD §9.3, architecture §6.4, build plan M36).
 * One instance per server process, shared by every TownRoom, so a mute follows the player into any
 * valley (there is one Fly Machine, architecture §3.1). Standings are read once per player (at
 * join) and written back through the safety store (`users/{uid}/safety/standing`, server-only)
 * after every change, one save after another, so a restart keeps active mutes.
 *
 * The rules are the shared pure ones (safety/strikes.ts); this class only keeps the records.
 */
export class ModerationService {
  private readonly standings = new Map<string, ModerationStanding>();
  private readonly saving = new Map<string, Promise<void>>();

  constructor(
    private readonly store: SafetyStore,
    private readonly metrics?: ServerMetrics,
  ) {}

  /** Reads the player's standing (once; later calls use the copy in memory). A failing read counts as clean. */
  async load(uid: string): Promise<void> {
    if (this.standings.has(uid)) return;
    let standing: ModerationStanding;
    try {
      standing = await this.store.getStanding(uid);
    } catch (err) {
      console.error(`[moderation] reading the standing of ${uid} failed:`, err);
      standing = emptyStanding();
    }
    // Another join may have loaded it meanwhile; keep the one in memory (it may hold newer strikes).
    if (!this.standings.has(uid)) this.standings.set(uid, standing);
  }

  /** When the player's shard-wide mute ends, or null. */
  mutedUntil(uid: string, now = Date.now()): number | null {
    const s = this.standings.get(uid);
    return s ? mutedUntil(s, now) : null;
  }

  /** Players muted right now (the metrics gauge). */
  mutedCount(now = Date.now()): number {
    let n = 0;
    for (const s of this.standings.values()) if (mutedUntil(s, now) !== null) n++;
    return n;
  }

  /** Records a strike against `uid`; a mute it starts applies at once in every shard. */
  strike(uid: string, strike: Omit<Strike, "at">, now = Date.now()): StrikeOutcome {
    const outcome = addStrike(this.standings.get(uid) ?? emptyStanding(), { ...strike, at: now }, now);
    this.standings.set(uid, outcome.standing);
    if (outcome.counted) {
      this.metrics?.inc("moderation.strikes");
      this.save(uid);
    }
    if (outcome.muted) {
      this.metrics?.inc("moderation.mutes");
      console.info(`[moderation] ${uid} muted shard-wide until ${new Date(outcome.muted.until).toISOString()} (level ${outcome.muted.level})`);
    }
    return outcome;
  }

  private save(uid: string): void {
    const previous = this.saving.get(uid) ?? Promise.resolve();
    const next = previous
      .then(() => this.store.saveStanding(uid, this.standings.get(uid) ?? emptyStanding()))
      .catch((err: unknown) => console.error(`[moderation] saving the standing of ${uid} failed:`, err));
    this.saving.set(uid, next);
  }

  /** Resolves when every pending save is done (tests). */
  async flush(): Promise<void> {
    await Promise.all(this.saving.values());
  }
}
