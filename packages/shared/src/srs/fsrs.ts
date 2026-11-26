import { z } from "zod";

/**
 * FSRS spaced-repetition scheduler (GDD §6.3, build plan M25), written here rather than pulled in
 * as a dependency: it is ~150 lines of pure math and `shared` has no DOM or Node APIs. It follows
 * FSRS-5 (the open-spaced-repetition reference, 19 weights, power forgetting curve with
 * DECAY −0.5 and FACTOR 19/81, same-day "short-term" stability, linear damping and mean reversion
 * of difficulty) with the default weights, a desired retention of 90 % and these choices:
 *
 * - Learning steps: a new or forgotten card comes back after 1 / 5 / 10 minutes (Again / Hard /
 *   Good) until it graduates with Good or Easy, like the reference scheduler's short-term mode.
 * - No interval fuzz, so schedules are deterministic (and testable). Intervals are whole days,
 *   1 … 36 500, and Hard ≤ Good < Easy on the same review.
 * - Times are epoch milliseconds (Firestore numbers, not Timestamps, so the client can write the
 *   card in one map field that `firestore.rules` checks key by key).
 */

export const FSRS_WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898,
  0.51655, 0.6621,
] as const;

export const FSRS_DECAY = -0.5;
export const FSRS_FACTOR = 19 / 81;
/** Desired retention: a review is scheduled when recall probability falls to 90 %. */
export const FSRS_REQUEST_RETENTION = 0.9;
export const FSRS_MAX_INTERVAL_DAYS = 36_500;

export const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Learning-step delays (minutes) for Again, Hard and Good before a card graduates. */
export const FSRS_LEARNING_STEPS_MIN = { again: 1, hard: 5, good: 10 } as const;
/** Relearning (after a lapse): Again and Hard delays (minutes). */
export const FSRS_RELEARNING_STEPS_MIN = { again: 5, hard: 10 } as const;

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 } as const;
export type Rating = (typeof Rating)[keyof typeof Rating];
export const RATINGS: readonly Rating[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

export const CardState = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
export type CardState = (typeof CardState)[keyof typeof CardState];

/** The card as stored in a notebook entry's `fsrs` map (≤ 16 keys, see firestore.rules). */
export const FsrsCardSchema = z.strictObject({
  /** Next review (epoch ms). */
  due: z.number().int().min(0),
  /** Days until recall probability falls to 90 %. */
  stability: z.number().min(0).max(1e6),
  /** 1 (easy) … 10 (hard). */
  difficulty: z.number().min(1).max(10),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  /** Last review (epoch ms), null for a card never reviewed. */
  lastReview: z.number().int().min(0).nullable(),
  /** Days scheduled at the last review (0 for a learning step). */
  scheduledDays: z.number().int().min(0).max(FSRS_MAX_INTERVAL_DAYS),
});
export type FsrsCard = z.infer<typeof FsrsCardSchema>;

/** A card that was never reviewed, due now. */
export function newCard(nowMs: number): FsrsCard {
  return { due: nowMs, stability: 0, difficulty: 1, state: CardState.New, reps: 0, lapses: 0, lastReview: null, scheduledDays: 0 };
}

const w = FSRS_WEIGHTS;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampD = (d: number) => clamp(d, 1, 10);
const S_MIN = 0.1;

/** Recall probability after `elapsedDays` with stability `s`. */
export function retrievability(elapsedDays: number, s: number): number {
  if (s <= 0) return 0;
  return Math.pow(1 + (FSRS_FACTOR * Math.max(0, elapsedDays)) / s, FSRS_DECAY);
}

/** Whole days until recall probability falls to the desired retention. */
export function nextIntervalDays(s: number, retention = FSRS_REQUEST_RETENTION): number {
  const raw = (s / FSRS_FACTOR) * (Math.pow(retention, 1 / FSRS_DECAY) - 1);
  return clamp(Math.round(raw), 1, FSRS_MAX_INTERVAL_DAYS);
}

export const initStability = (g: Rating) => Math.max(w[g - 1]!, S_MIN);
export const initDifficulty = (g: Rating) => clampD(w[4] - Math.exp(w[5] * (g - 1)) + 1);

export function nextDifficulty(d: number, g: Rating): number {
  const delta = -w[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clampD(w[7] * initDifficulty(Rating.Easy) + (1 - w[7]) * damped);
}

export function recallStability(d: number, s: number, r: number, g: Rating): number {
  const hardPenalty = g === Rating.Hard ? w[15] : 1;
  const easyBonus = g === Rating.Easy ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hardPenalty * easyBonus);
}

export function forgetStability(d: number, s: number, r: number): number {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  return Math.max(S_MIN, Math.min(sf, s));
}

export function shortTermStability(s: number, g: Rating): number {
  return Math.max(S_MIN, s * Math.exp(w[17] * (g - 3 + w[18])));
}

const minutes = (now: number, m: number) => now + m * MINUTE_MS;
const days = (now: number, d: number) => now + d * DAY_MS;

/** Days between the last review and now (fractional; 0 for a card never reviewed). */
export function elapsedDays(card: FsrsCard, nowMs: number): number {
  return card.lastReview === null ? 0 : Math.max(0, (nowMs - card.lastReview) / DAY_MS);
}

/** The card after each of the four ratings at `nowMs` (what the review buttons preview). */
export function previewReview(card: FsrsCard, nowMs: number): Record<Rating, FsrsCard> {
  const base = { reps: card.reps + 1, lapses: card.lapses, lastReview: nowMs };
  const out = {} as Record<Rating, FsrsCard>;

  if (card.state === CardState.New) {
    for (const g of RATINGS) {
      const stability = initStability(g);
      const difficulty = initDifficulty(g);
      if (g === Rating.Easy) {
        const ivl = nextIntervalDays(stability);
        out[g] = { ...base, stability, difficulty, state: CardState.Review, due: days(nowMs, ivl), scheduledDays: ivl };
      } else {
        const step = g === Rating.Again ? FSRS_LEARNING_STEPS_MIN.again : g === Rating.Hard ? FSRS_LEARNING_STEPS_MIN.hard : FSRS_LEARNING_STEPS_MIN.good;
        out[g] = { ...base, stability, difficulty, state: CardState.Learning, due: minutes(nowMs, step), scheduledDays: 0 };
      }
    }
    return out;
  }

  const t = elapsedDays(card, nowMs);
  const sameDay = t < 1;
  const r = retrievability(t, card.stability);
  const stabilityFor = (g: Rating) =>
    sameDay ? shortTermStability(card.stability, g) : g === Rating.Again ? forgetStability(card.difficulty, card.stability, r) : recallStability(card.difficulty, card.stability, r, g);
  const s = Object.fromEntries(RATINGS.map((g) => [g, stabilityFor(g)])) as Record<Rating, number>;
  const d = Object.fromEntries(RATINGS.map((g) => [g, nextDifficulty(card.difficulty, g)])) as Record<Rating, number>;

  if (card.state === CardState.Learning || card.state === CardState.Relearning) {
    const steps = card.state === CardState.Learning ? FSRS_LEARNING_STEPS_MIN : FSRS_RELEARNING_STEPS_MIN;
    const good = nextIntervalDays(s[Rating.Good]);
    const easy = Math.max(nextIntervalDays(s[Rating.Easy]), good + 1);
    out[Rating.Again] = { ...base, stability: s[1], difficulty: d[1], state: card.state, due: minutes(nowMs, steps.again), scheduledDays: 0 };
    out[Rating.Hard] = { ...base, stability: s[2], difficulty: d[2], state: card.state, due: minutes(nowMs, steps.hard), scheduledDays: 0 };
    out[Rating.Good] = { ...base, stability: s[3], difficulty: d[3], state: CardState.Review, due: days(nowMs, good), scheduledDays: good };
    out[Rating.Easy] = { ...base, stability: s[4], difficulty: d[4], state: CardState.Review, due: days(nowMs, easy), scheduledDays: easy };
    return out;
  }

  // Review.
  let hard = nextIntervalDays(s[Rating.Hard]);
  let good = nextIntervalDays(s[Rating.Good]);
  hard = Math.min(hard, good);
  good = Math.max(good, hard + 1);
  const easy = Math.max(nextIntervalDays(s[Rating.Easy]), good + 1);
  out[Rating.Again] = {
    ...base,
    lapses: card.lapses + 1,
    stability: s[1],
    difficulty: d[1],
    state: CardState.Relearning,
    due: minutes(nowMs, FSRS_RELEARNING_STEPS_MIN.again),
    scheduledDays: 0,
  };
  out[Rating.Hard] = { ...base, stability: s[2], difficulty: d[2], state: CardState.Review, due: days(nowMs, hard), scheduledDays: hard };
  out[Rating.Good] = { ...base, stability: s[3], difficulty: d[3], state: CardState.Review, due: days(nowMs, good), scheduledDays: good };
  out[Rating.Easy] = { ...base, stability: s[4], difficulty: d[4], state: CardState.Review, due: days(nowMs, easy), scheduledDays: easy };
  return out;
}

/** The card after one review. */
export function reviewCard(card: FsrsCard, rating: Rating, nowMs: number): FsrsCard {
  return previewReview(card, nowMs)[rating];
}

/** Recall probability of a card now (1 for a card never reviewed, which has nothing to forget yet). */
export function cardRetrievability(card: FsrsCard, nowMs: number): number {
  if (card.state === CardState.New) return 1;
  return retrievability(elapsedDays(card, nowMs), card.stability);
}
