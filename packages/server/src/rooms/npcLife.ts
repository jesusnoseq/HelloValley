import {
  AMBIENT_BARKS_PER_SET,
  AMBIENT_EXCHANGES_PER_PAIR,
  type AmbientBark,
  atTarget,
  BARK_HEAR_RADIUS_M,
  type Emote,
  exchangePairs,
  headingTowards,
  idleDelayS,
  NPC_IDS,
  type NpcId,
  type NpcLocator,
  type NpcWalker,
  pickIdle,
  placeWalker,
  retarget,
  scheduleIndexAt,
  SEAT_SMALL_TALK_RADIUS_M,
  type SpaceId,
  stepWalker,
  targetAt,
  type Vec2,
  walkerIdle,
  walkerWhere,
  walkTo,
  worldClockAt,
} from "@hellovalley/shared";

export interface NpcLifeOptions {
  /** The clock (tests fix it; the schedules follow the world clock of this time). */
  now?: () => number;
  /** Random source for idle behaviours and barks (tests fix it). */
  random?: () => number;
}

/** A bark the room sends to the players near `pos`. */
export interface BarkEvent {
  bark: AmbientBark;
  space: SpaceId;
  pos: Vec2;
}

export interface LifeEvents {
  emotes: { npcId: NpcId; emote: Emote; space: SpaceId }[];
  barks: BarkEvent[];
}

/** A clock jump longer than this (a test, a stalled process) puts the villagers straight at their targets (s). */
export const LIFE_JUMP_S = 5;
/** One NPC says a solo line at most this often (ms, my number). */
export const SOLO_BARK_COOLDOWN_MS = 45_000;
/** One pair has an exchange at most this often (ms). */
export const PAIR_BARK_COOLDOWN_MS = 90_000;
/** At most one bark per shard this often, so the town does not chatter (ms). */
export const ROOM_BARK_GAP_MS = 8_000;
/** Chance per tick that a standing NPC with a listener nearby says a line (5 ticks a second: ~one per 4 s once cooled down). */
export const SOLO_BARK_CHANCE = 0.05;
/** A solo line needs a player this close (metres). */
export const SOLO_BARK_RADIUS_M = 6;

/**
 * The villagers of one TownRoom shard (build plan M31, GDD §8.3). Each follows its schedule
 * (shared npc/life.ts): when the world clock reaches its next point it walks there with A*,
 * through the doors. An NPC someone talks to stops and faces them (and catches up with its
 * schedule afterwards). Standing NPCs play idle behaviours, and the room's ambient barks are
 * picked here: exchanges between related villagers standing together, and solo lines, only when a
 * player is near enough to hear them.
 */
export class NpcLife {
  private readonly walkers = new Map<NpcId, NpcWalker>();
  private readonly nextIdle = new Map<NpcId, number>();
  private readonly soloAt = new Map<NpcId, number>();
  private readonly pairAt = new Map<string, number>();
  private lastBark = Number.NEGATIVE_INFINITY;
  private last: number;
  readonly now: () => number;
  private readonly random: () => number;

  constructor(options: NpcLifeOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.last = this.now();
    this.placeAll();
  }

  private placeAll(): void {
    const minutes = worldClockAt(this.now()).minutes;
    for (const id of NPC_IDS) {
      this.walkers.set(id, placeWalker(id, minutes));
      this.nextIdle.set(id, this.last + idleDelayS(this.random) * 1000);
    }
  }

  /** Where each NPC is now. */
  readonly locate: NpcLocator = (npcId) => walkerWhere(this.walkers.get(npcId)!);

  walker(npcId: NpcId): NpcWalker {
    return this.walkers.get(npcId)!;
  }

  /**
   * One step. `talking` maps the NPCs in a conversation to the position of (one of) their players,
   * `listeners` are the players' positions (barks need someone to hear them).
   */
  tick(talking: ReadonlyMap<NpcId, Vec2>, listeners: readonly { space: SpaceId; pos: Vec2 }[]): LifeEvents {
    const now = this.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const events: LifeEvents = { emotes: [], barks: [] };
    if (dt <= 0) return events;
    const minutes = worldClockAt(now).minutes;
    if (dt > LIFE_JUMP_S) {
      // A jump: everyone is where their schedule says (talking NPCs too: the conversation ends by walking away).
      for (const id of NPC_IDS) if (!talking.has(id)) this.walkers.set(id, placeWalker(id, minutes));
      return events;
    }
    for (const id of NPC_IDS) {
      const w = this.walkers.get(id)!;
      const partner = talking.get(id);
      if (partner) {
        // Stops and faces the player (GDD §8.1 "the NPC turns"); the walk resumes afterwards.
        w.motion = "idle";
        if (Math.hypot(partner[0] - w.pos[0], partner[1] - w.pos[1]) > 0.05) w.heading = headingTowards(w.pos, partner);
        this.nextIdle.set(id, now + idleDelayS(this.random) * 1000);
        continue;
      }
      const index = scheduleIndexAt(id, minutes);
      if (index !== w.scheduleIndex) retarget(w, index, targetAt(id, minutes));
      else if (walkerIdle(w) && w.follow === null && w.legs.length === 0 && !atTarget(w) && w.target.activity !== "walk") walkTo(w, w.target);
      const r = stepWalker(w, dt);
      if (r === "arrived") this.nextIdle.set(id, now + idleDelayS(this.random) * 1000);
      if (r !== "standing") continue;
      if (now < (this.nextIdle.get(id) ?? 0)) continue;
      this.nextIdle.set(id, now + idleDelayS(this.random) * 1000);
      const action = pickIdle(w, this.random);
      if (action?.kind === "emote") events.emotes.push({ npcId: id, emote: action.emote, space: w.space });
      else if (action?.kind === "stroll") walkTo(w, action.goal);
      else if (action?.kind === "home") walkTo(w, w.target);
    }
    const bark = this.pickBark(now, talking, listeners);
    if (bark) events.barks.push(bark);
    return events;
  }

  private standing(talking: ReadonlyMap<NpcId, Vec2>): NpcWalker[] {
    return NPC_IDS.map((id) => this.walkers.get(id)!).filter((w) => walkerIdle(w) && !talking.has(w.npcId));
  }

  private heard(space: SpaceId, pos: Vec2, listeners: readonly { space: SpaceId; pos: Vec2 }[], radius: number): boolean {
    return listeners.some((l) => l.space === space && Math.hypot(l.pos[0] - pos[0], l.pos[1] - pos[1]) <= radius);
  }

  private pickBark(now: number, talking: ReadonlyMap<NpcId, Vec2>, listeners: readonly { space: SpaceId; pos: Vec2 }[]): BarkEvent | null {
    if (now - this.lastBark < ROOM_BARK_GAP_MS || listeners.length === 0) return null;
    const standing = this.standing(talking);
    // Exchanges first: related villagers standing together (the NPC doc's relationships).
    for (const pair of exchangePairs(standing.map(walkerWhere))) {
      const key = `${pair.a}+${pair.b}`;
      if (now - (this.pairAt.get(key) ?? Number.NEGATIVE_INFINITY) < PAIR_BARK_COOLDOWN_MS) continue;
      const a = this.walkers.get(pair.a)!;
      const b = this.walkers.get(pair.b)!;
      const mid: Vec2 = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2];
      if (!this.heard(a.space, mid, listeners, BARK_HEAR_RADIUS_M)) continue;
      this.pairAt.set(key, now);
      this.lastBark = now;
      // They turn to each other.
      a.heading = headingTowards(a.pos, b.pos);
      b.heading = headingTowards(b.pos, a.pos);
      return { bark: { kind: "exchange", a: pair.a, b: pair.b, index: Math.floor(this.random() * AMBIENT_EXCHANGES_PER_PAIR) }, space: a.space, pos: mid };
    }
    for (const w of standing) {
      if (now - (this.soloAt.get(w.npcId) ?? Number.NEGATIVE_INFINITY) < SOLO_BARK_COOLDOWN_MS) continue;
      if (!this.heard(w.space, w.pos, listeners, SOLO_BARK_RADIUS_M) || this.random() >= SOLO_BARK_CHANCE) continue;
      return this.solo(w, now);
    }
    return null;
  }

  private solo(w: NpcWalker, now: number): BarkEvent {
    this.soloAt.set(w.npcId, now);
    this.lastBark = now;
    return { bark: { kind: "solo", npcId: w.npcId, activity: w.target.activity, index: Math.floor(this.random() * AMBIENT_BARKS_PER_SET) }, space: w.space, pos: [w.pos[0], w.pos[1]] };
  }

  /**
   * Small talk for a player who just sat down (GDD §5.4, the M29 TODO): the nearest standing
   * villager within SEAT_SMALL_TALK_RADIUS_M says a line, cooldowns aside. Null when nobody is near.
   */
  smallTalk(space: SpaceId, pos: Vec2, talking: ReadonlyMap<NpcId, Vec2>): BarkEvent | null {
    let best: { w: NpcWalker; d: number } | null = null;
    for (const w of this.standing(talking)) {
      if (w.space !== space || w.target.activity === "sleep") continue;
      const d = Math.hypot(w.pos[0] - pos[0], w.pos[1] - pos[1]);
      if (d <= SEAT_SMALL_TALK_RADIUS_M && (!best || d < best.d)) best = { w, d };
    }
    if (!best) return null;
    best.w.heading = headingTowards(best.w.pos, pos);
    return this.solo(best.w, this.now());
  }
}
