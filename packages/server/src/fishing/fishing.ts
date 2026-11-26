import { randomInt, randomUUID } from "node:crypto";
import {
  CAST_COOLDOWN_MS,
  CAST_MAX_M,
  castDistance,
  castExpiresAt,
  castLanding,
  createRng,
  type FishCastMessage,
  type FishCastResultMessage,
  fishingSpotAt,
  type FishLogMessage,
  type FishReelMessage,
  type FishResultMessage,
  getNpc,
  isHotbarSlot,
  judgeReel,
  nearElderOnDock,
  type PendingCast,
  rollCast,
  seedFrom,
  SHADOW_FOR_RARITY,
  type SpaceId,
  SPOT_SLACK_M,
  type Vec2,
  weatherAt,
  WORLD_WEATHER_SEED,
  worldClockAt,
} from "@hellovalley/shared";
import type { FishingStore } from "./fishingStore";

/**
 * Fishing on the server (build plan M27, GDD §5.2, architecture §6.1: the server is
 * authoritative). `fish:cast` is checked against the player's server-side position (a fishing
 * spot, the bobber in open water), the rod in the named hotbar slot and the pacing (one cast at a
 * time, a cooldown after each); then the server rolls the fish on the shared rarity table for the
 * world's time of day and weather with a seeded RNG, and keeps it secret. The client plays the
 * bite and the mini-game and reports the outcome (`fish:reel`); a catch is accepted only for the
 * cast the server rolled, within its timing window, from where the line was cast, and it lands
 * the server's fish, never one the client names.
 */

/** Where the player is, from the room's own records. */
export interface FishingWhere {
  space: SpaceId;
  pos: Vec2;
  talking: boolean;
}

export interface FishingServiceOptions {
  /** The clock (tests advance a fake one). */
  now?: () => number;
  /** Mixed into every cast's seed; random per process by default, fixed in tests. */
  seed?: number;
  /** The player's fishing luck (build plan M29: the fish stew buff, from the food service). */
  luck?: (uid: string) => number;
}

export class FishingService {
  private readonly casts = new Map<string, PendingCast>();
  private readonly lastEnd = new Map<string, number>();
  private readonly starting = new Set<string>();
  private counter = 0;
  readonly now: () => number;
  private readonly seed: number;
  private readonly luck: (uid: string) => number;

  constructor(
    private readonly store: FishingStore,
    options: FishingServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.seed = options.seed ?? randomInt(2 ** 31);
    this.luck = options.luck ?? (() => 0);
  }

  /** The player's open cast, if any (expired ones are dropped). */
  pending(uid: string): PendingCast | undefined {
    const cast = this.casts.get(uid);
    if (cast && this.now() > castExpiresAt(cast)) {
      this.end(uid);
      return undefined;
    }
    return cast;
  }

  async cast(uid: string, lang: string, msg: FishCastMessage, where: FishingWhere): Promise<FishCastResultMessage> {
    const now = this.now();
    if (this.pending(uid) || this.starting.has(uid)) return { ok: false, reason: "busy" };
    if (now - (this.lastEnd.get(uid) ?? Number.NEGATIVE_INFINITY) < CAST_COOLDOWN_MS) return { ok: false, reason: "cooldown" };
    if (where.talking) return { ok: false, reason: "talking" };
    if (!isHotbarSlot(msg.slot)) return { ok: false, reason: "no_rod" };
    this.starting.add(uid);
    try {
      let context;
      try {
        context = await this.store.context(uid, lang);
      } catch (err) {
        console.error(`[fishing] reading ${uid}/${lang} failed:`, err);
        return { ok: false, reason: "unavailable" };
      }
      if (!context) return { ok: false, reason: "unavailable" };
      if (context.slots.find((s) => s.slot === msg.slot)?.itemId !== "fishing_rod") return { ok: false, reason: "no_rod" };
      const spot = fishingSpotAt(where.space, where.pos, { elderHearts: context.elderHearts, slack: SPOT_SLACK_M });
      if (!spot) return { ok: false, reason: "not_at_spot" };
      const landing = castLanding(where.pos, msg.heading, castDistance(msg.charge));
      if (!landing) return { ok: false, reason: "no_water" };
      const castAt = this.now();
      const conditions = { timeOfDay: worldClockAt(castAt).timeOfDay, weather: weatherAt(castAt, WORLD_WEATHER_SEED).weather, spot };
      const rng = createRng(seedFrom(this.seed, uid, this.counter++, castAt));
      const roll = rollCast(conditions, landing.distance / CAST_MAX_M, rng, this.luck(uid));
      if (!roll) return { ok: false, reason: "no_water" };
      const cast: PendingCast = {
        castId: randomUUID(),
        fishId: roll.fishId,
        rarity: roll.rarity,
        spot,
        castAtMs: castAt,
        biteAtMs: castAt + roll.biteDelayMs,
        pos: [where.pos[0], where.pos[1]],
        bobber: landing.point,
      };
      this.casts.set(uid, cast);
      return {
        ok: true,
        castId: cast.castId,
        spot,
        bobber: { x: landing.point[0], z: landing.point[1] },
        distance: landing.distance,
        biteInMs: roll.biteDelayMs,
        rarity: roll.rarity,
        shadow: SHADOW_FOR_RARITY[roll.rarity],
        reelSeed: roll.reelSeed,
      };
    } finally {
      this.starting.delete(uid);
    }
  }

  async reel(uid: string, lang: string, msg: FishReelMessage, where: Pick<FishingWhere, "space" | "pos">): Promise<FishResultMessage> {
    const now = this.now();
    const cast = this.casts.get(uid);
    const verdict = judgeReel(cast, msg.castId, msg.outcome, now, where.space, where.pos);
    if (!verdict.ok) {
      // A refused report ends the cast (no second try at a forged catch).
      if (verdict.reason !== "no_cast") this.end(uid);
      return { castId: msg.castId, outcome: "refused", reason: verdict.reason };
    }
    this.end(uid);
    if (msg.outcome === "escaped") return { castId: msg.castId, outcome: "escaped" };
    let outcome;
    try {
      outcome = await this.store.recordCatch(uid, lang, cast!.fishId, now);
    } catch (err) {
      console.error(`[fishing] saving a catch for ${uid}/${lang} failed:`, err);
      outcome = null;
    }
    if (!outcome) return { castId: msg.castId, outcome: "refused", reason: "unavailable" };
    return {
      castId: msg.castId,
      outcome: "caught",
      fishId: cast!.fishId,
      rarity: cast!.rarity,
      first: outcome.first,
      kept: outcome.kept,
      entry: outcome.entry,
      elderNearby: nearElderOnDock(getNpc("elder"), worldClockAt(now).minutes, where.space, where.pos),
    };
  }

  /** The encyclopedia for `fish:log`, or null when it could not be read. */
  async log(uid: string): Promise<FishLogMessage | null> {
    try {
      return { species: await this.store.log(uid) };
    } catch (err) {
      console.error(`[fishing] reading the encyclopedia of ${uid} failed:`, err);
      return null;
    }
  }

  /** The player walked away or left: the cast (if any) ends. True when there was one. */
  cancel(uid: string): boolean {
    if (!this.casts.has(uid)) return false;
    this.end(uid);
    return true;
  }

  /** The player left the server: forget their pacing too. */
  forget(uid: string): void {
    this.casts.delete(uid);
    this.lastEnd.delete(uid);
  }

  private end(uid: string): void {
    this.casts.delete(uid);
    this.lastEnd.set(uid, this.now());
  }
}
