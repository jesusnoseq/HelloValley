import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import {
  type AvatarAppearance,
  FirestorePaths,
  type OnboardingRecords,
  type UserProfile,
  UserProfileSchema,
  withAppearance,
} from "@hellovalley/shared";

/**
 * Player profiles (`users/{uid}`) as the server sees them. The server is the only writer of a new
 * profile and its first `langs/{lang}` document (architecture §7.2, §8.1).
 */
export interface ProfileStore {
  /** The stored profile, or null when the player has not finished onboarding. */
  getProfile(uid: string): Promise<UserProfile | null>;
  /**
   * Creates `users/{uid}` and `users/{uid}/langs/{lang}` together. When the profile already exists
   * nothing is written and the stored profile comes back with `created: false` (a retried or
   * double-submitted onboarding is harmless; it never re-rolls the apartment or the coins).
   */
  createProfile(uid: string, records: OnboardingRecords): Promise<{ created: boolean; profile: UserProfile }>;
  /**
   * Replaces `animal` and `colors` of an existing profile (the apartment mirror, build plan M15)
   * and returns the updated profile, or null when the player has no profile yet. Nothing else in
   * the document changes.
   */
  updateAppearance(uid: string, appearance: AvatarAppearance): Promise<UserProfile | null>;
}

/** Thrown when a stored profile no longer matches the schema (hand-edited or from an old version). */
export class CorruptProfileError extends Error {
  constructor(uid: string, cause: unknown) {
    super(`users/${uid} does not match UserProfileSchema`, { cause });
    this.name = "CorruptProfileError";
  }
}

function parseStored(uid: string, data: unknown): UserProfile {
  // The rules do not check that the fur tint belongs to the animal; the schema does (M03 note).
  const parsed = UserProfileSchema.safeParse(data);
  if (!parsed.success) throw new CorruptProfileError(uid, parsed.error);
  return parsed.data;
}

/** Firestore through the Admin SDK (bypasses the security rules). */
export function createFirestoreProfileStore(db: Firestore): ProfileStore {
  return {
    async getProfile(uid) {
      const snap = await db.doc(FirestorePaths.user(uid)).get();
      return snap.exists ? parseStored(uid, snap.data()) : null;
    },
    async createProfile(uid, records) {
      const userRef = db.doc(FirestorePaths.user(uid));
      const langRef = db.doc(FirestorePaths.lang(uid, records.lang.code));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (snap.exists) return { created: false, profile: parseStored(uid, snap.data()) };
        tx.create(userRef, records.profile);
        tx.create(langRef, records.lang.progress);
        return { created: true, profile: records.profile };
      });
    },
    async updateAppearance(uid, appearance) {
      const userRef = db.doc(FirestorePaths.user(uid));
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return null;
        // Validate the whole result before writing, so a write never leaves a document the schema rejects.
        const next = UserProfileSchema.parse(withAppearance(parseStored(uid, snap.data()), appearance));
        tx.update(userRef, { animal: next.animal, colors: next.colors });
        return next;
      });
    },
  };
}

export function firestoreProfileStoreFor(app: App): ProfileStore {
  return createFirestoreProfileStore(getFirestore(app));
}

/** An in-memory store for tests (and the shape the Firestore store must match). */
export interface MemoryProfileStore extends ProfileStore {
  readonly profiles: Map<string, UserProfile>;
  readonly langs: Map<string, OnboardingRecords["lang"]["progress"]>;
}

export function createMemoryProfileStore(initial: Record<string, UserProfile> = {}): MemoryProfileStore {
  const profiles = new Map(Object.entries(initial));
  const langs = new Map<string, OnboardingRecords["lang"]["progress"]>();
  return {
    profiles,
    langs,
    async getProfile(uid) {
      return profiles.get(uid) ?? null;
    },
    async createProfile(uid, records) {
      const existing = profiles.get(uid);
      if (existing) return { created: false, profile: existing };
      profiles.set(uid, records.profile);
      langs.set(FirestorePaths.lang(uid, records.lang.code), records.lang.progress);
      return { created: true, profile: records.profile };
    },
    async updateAppearance(uid, appearance) {
      const existing = profiles.get(uid);
      if (!existing) return null;
      const next = UserProfileSchema.parse(withAppearance(existing, appearance));
      profiles.set(uid, next);
      return next;
    },
  };
}
