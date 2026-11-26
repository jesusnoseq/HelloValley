import {
  type ActiveBuff,
  activeBuffs,
  addBuff,
  atKitchen,
  buffRemainingMs,
  COOK_COOLDOWN_MS,
  type CookResultMessage,
  EAT_COOLDOWN_MS,
  eatEffects,
  type EatLog,
  type Emote,
  eatingFlags,
  extraReplyHints,
  fishingLuck,
  type FoodEatenMessage,
  KITCHEN_SLACK_M,
  knownRecipeIds,
  type NpcId,
  type RecipeBookMessage,
  type RecipeId,
  recordEaten,
  type SpaceId,
  type Vec2,
  walkSpeedFactor,
  type WireBuff,
  worldDayAt,
} from "@hellovalley/shared";
import type { FoodStore } from "./foodStore";

/**
 * Eating, buffs and cooking on the server (build plan M29, GDD §5.4, architecture §6.1: the server
 * is authoritative). `food:eat` takes one bite from a hotbar slot in a store transaction and adds
 * the buff with the shared rules (food/buffs.ts); `cook:make` cooks a learned recipe at the
 * apartment kitchen. The buffs are read where they matter: the walk speed in the TownRoom's
 * movement check, the fishing luck in the cast roll, the coffee's extra hint and the "what the
 * player ate today" flags in the NPC context.
 *
 * Buffs and today's eating log live in memory, per uid across shards: there is one server process
 * (architecture §3.1), so a reconnect keeps them and a restart drops them (a few minutes of buff;
 * pending.md §M29). The recipe book is stored (`users/{uid}/collections/recipes`).
 */

export interface FoodServiceOptions {
  /** The clock (tests advance a fake one). */
  now?: () => number;
}

/** Where the player is, from the room's own records. */
export interface FoodWhere {
  space: SpaceId;
  pos: Vec2;
  /** Fishing (or otherwise unable to use their hands). */
  busy: boolean;
}

export interface EatResult {
  message: FoodEatenMessage;
  /** The emote the bite plays for everyone around (the cake's cheer). */
  emote: Emote | null;
}

/** What the NPC dialogue service reads from food (build plan M29). */
export interface DialogueFood {
  knownRecipes(uid: string): Promise<string[]>;
  learnRecipes(uid: string, recipeIds: readonly string[], teacher: NpcId, lang: string): Promise<RecipeId[]>;
  flags(uid: string, npcId: NpcId): string[];
  extraHints(uid: string): number;
}

export class FoodService implements DialogueFood {
  private readonly buffs = new Map<string, ActiveBuff[]>();
  private readonly logs = new Map<string, EatLog>();
  private readonly lastEat = new Map<string, number>();
  private readonly lastCook = new Map<string, number>();
  readonly now: () => number;

  constructor(
    private readonly store: FoodStore,
    options: FoodServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  private live(uid: string, now = this.now()): ActiveBuff[] {
    const list = activeBuffs(this.buffs.get(uid) ?? [], now);
    if (list.length) this.buffs.set(uid, list);
    else this.buffs.delete(uid);
    return list;
  }

  /** The running buffs as the player is told them. */
  wireBuffs(uid: string): WireBuff[] {
    const now = this.now();
    return this.live(uid, now).map((b) => toWire(b, now));
  }

  /** When the next running buff ends (ms on the service clock), or null. */
  nextExpiry(uid: string): number | null {
    const list = this.live(uid);
    return list.length ? Math.min(...list.map((b) => b.expiresMs)) : null;
  }

  speedFactor(uid: string): number {
    return walkSpeedFactor(this.buffs.get(uid) ?? [], this.now());
  }

  luck(uid: string): number {
    return fishingLuck(this.buffs.get(uid) ?? [], this.now());
  }

  extraHints(uid: string): number {
    return extraReplyHints(this.buffs.get(uid) ?? [], this.now());
  }

  flags(uid: string, npcId: NpcId): string[] {
    return eatingFlags(npcId, this.logs.get(uid) ?? null, worldDayAt(this.now()));
  }

  /** `food:eat`: one bite from a hotbar slot. */
  async eat(uid: string, lang: string, slot: number, busy: boolean): Promise<EatResult> {
    const refuse = (reason: Extract<FoodEatenMessage, { ok: false }>["reason"]): EatResult => ({ message: { slot, ok: false, reason }, emote: null });
    const now = this.now();
    if (now - (this.lastEat.get(uid) ?? Number.NEGATIVE_INFINITY) < EAT_COOLDOWN_MS) return refuse("cooldown");
    if (busy) return refuse("busy");
    this.lastEat.set(uid, now);
    let outcome;
    try {
      outcome = await this.store.eat(uid, lang, slot);
    } catch (err) {
      console.error(`[food] a bite for ${uid} failed:`, err);
      return refuse("unavailable");
    }
    if (!outcome.ok) return refuse(outcome.reason);
    const at = this.now();
    const effects = eatEffects(outcome.itemId);
    let buff: WireBuff | null = null;
    if (effects.buff) {
      const next = addBuff(this.buffs.get(uid) ?? [], outcome.itemId, effects.buff, at);
      this.buffs.set(uid, next);
      buff = toWire(next.find((b) => b.kind === effects.buff!.kind)!, at);
    }
    this.logs.set(uid, recordEaten(this.logs.get(uid) ?? null, outcome.itemId, worldDayAt(at)));
    return { message: { slot, ok: true, itemId: outcome.itemId, buff, emote: effects.emote }, emote: effects.emote };
  }

  /** `cook:make`: a learned recipe at the apartment kitchen. */
  async cook(uid: string, lang: string, recipeId: RecipeId, where: FoodWhere): Promise<CookResultMessage> {
    const refuse = (reason: Extract<CookResultMessage, { ok: false }>["reason"]): CookResultMessage => ({ recipeId, ok: false, reason });
    const now = this.now();
    if (now - (this.lastCook.get(uid) ?? Number.NEGATIVE_INFINITY) < COOK_COOLDOWN_MS) return refuse("cooldown");
    if (where.busy) return refuse("busy");
    if (!atKitchen(where.space, where.pos, KITCHEN_SLACK_M)) return refuse("not_at_kitchen");
    this.lastCook.set(uid, now);
    let outcome;
    try {
      outcome = await this.store.cook(uid, lang, recipeId);
    } catch (err) {
      console.error(`[food] cooking ${recipeId} for ${uid} failed:`, err);
      return refuse("unavailable");
    }
    if (!outcome.ok) return { recipeId, ok: false, reason: outcome.reason, ...(outcome.missing ? { missing: outcome.missing } : {}) };
    return { recipeId, ok: true, itemId: outcome.result, uses: outcome.uses };
  }

  /** The recipe book for `recipes:book`, or null when it could not be read. */
  async book(uid: string): Promise<RecipeBookMessage | null> {
    try {
      return { book: await this.store.book(uid) };
    } catch (err) {
      console.error(`[food] reading the recipe book of ${uid} failed:`, err);
      return null;
    }
  }

  /** DialogueFood: the recipes the player knows (throws when the store fails, like the NPC store). */
  async knownRecipes(uid: string): Promise<string[]> {
    return knownRecipeIds(await this.store.book(uid));
  }

  /** DialogueFood: an accepted `teachRecipe` goes into the book. */
  async learnRecipes(uid: string, recipeIds: readonly string[], teacher: NpcId, lang: string): Promise<RecipeId[]> {
    return (await this.store.learn(uid, recipeIds, teacher, lang, this.now())).learned;
  }

  /** The player left: drop their pacing (buffs and today's log stay for a reconnect, and run out on their own). */
  forget(uid: string): void {
    this.lastEat.delete(uid);
    this.lastCook.delete(uid);
    this.live(uid);
    if (this.logs.get(uid)?.day !== worldDayAt(this.now())) this.logs.delete(uid);
  }
}

function toWire(b: ActiveBuff, now: number): WireBuff {
  return { kind: b.kind, amount: b.amount, itemId: b.itemId, remainingMs: buffRemainingMs(b, now), durationMs: b.expiresMs - b.startedMs };
}
