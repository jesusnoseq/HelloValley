import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { FirestorePaths, LangProgressSchema, nextStreak, type StreakState } from "@hellovalley/shared";

/**
 * The review streak (build plan M25, GDD §6.3 stats). `users/{uid}/langs/{lang}.streak` is
 * server-written (architecture §8.1); the notebook itself is the player's own, so the server
 * only checks that a card was reviewed recently (`fsrs.lastReview`) before counting the day.
 * The streak is not economy: a player who forges a review only fools their own streak.
 */
export type StreakResult = { ok: true; state: StreakState } | { ok: false; reason: "not_found" | "no_review" };

export interface StreakStore {
  /** A review session finished on local day `day`; `sinceMs`: the oldest review that counts. */
  recordReview(uid: string, lang: string, day: number, sinceMs: number): Promise<StreakResult>;
}

export function createFirestoreStreakStore(db: Firestore): StreakStore {
  return {
    async recordReview(uid, lang, day, sinceMs) {
      const reviewed = await db.collection(FirestorePaths.notebook(uid, lang)).where("fsrs.lastReview", ">=", sinceMs).limit(1).get();
      const langRef = db.doc(FirestorePaths.lang(uid, lang));
      return db.runTransaction(async (tx): Promise<StreakResult> => {
        const snap = await tx.get(langRef);
        if (!snap.exists) return { ok: false, reason: "not_found" };
        if (reviewed.empty) return { ok: false, reason: "no_review" };
        const progress = LangProgressSchema.parse(snap.data());
        const next = nextStreak({ streak: progress.streak, day: progress.streakDay ?? null }, day);
        if (next.changed) tx.update(langRef, { streak: next.streak, streakDay: next.day });
        return { ok: true, state: { streak: next.streak, day: next.day } };
      });
    },
  };
}

export function firestoreStreakStoreFor(app: App): StreakStore {
  return createFirestoreStreakStore(getFirestore(app));
}

export interface MemoryStreakPlayer {
  streak: number;
  day: number | null;
  /** Times (ms) of the notebook's last reviews. */
  reviews: number[];
}

/** In memory, keyed by `${uid}/${lang}` (tests and runs without Firestore). */
export function createMemoryStreakStore(initial: Record<string, MemoryStreakPlayer> = {}): StreakStore & { players: Map<string, MemoryStreakPlayer> } {
  const players = new Map(Object.entries(initial));
  return {
    players,
    async recordReview(uid, lang, day, sinceMs) {
      const p = players.get(`${uid}/${lang}`);
      if (!p) return { ok: false, reason: "not_found" };
      if (!p.reviews.some((t) => t >= sinceMs)) return { ok: false, reason: "no_review" };
      const next = nextStreak({ streak: p.streak, day: p.day }, day);
      p.streak = next.streak;
      p.day = next.day;
      return { ok: true, state: { streak: next.streak, day: next.day } };
    },
  };
}
