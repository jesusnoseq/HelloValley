import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import { type ApartmentLayoutData, ApartmentLayoutSchema, cloneLayout, FirestorePaths } from "@hellovalley/shared";

/**
 * Apartment furniture layouts (`users/{uid}/apartment/layout`, GDD §9.4, build plan M17). The
 * server is the only writer (architecture §8.1: the owner may read it, never write it): the
 * ApartmentRoom saves a layout only after every edit passed the shared placement rules.
 */
export interface ApartmentLayoutStore {
  /** The stored layout, or null when the owner never changed the starting furniture. */
  getLayout(uid: string): Promise<ApartmentLayoutData | null>;
  /** Replaces the stored layout. */
  saveLayout(uid: string, layout: ApartmentLayoutData): Promise<void>;
}

/** Thrown when a stored layout no longer matches the schema (hand-edited, or from an old version). */
export class CorruptLayoutError extends Error {
  constructor(uid: string, cause: unknown) {
    super(`users/${uid}/apartment/layout does not match ApartmentLayoutSchema`, { cause });
    this.name = "CorruptLayoutError";
  }
}

/** Firestore through the Admin SDK (bypasses the security rules). */
export function createFirestoreLayoutStore(db: Firestore): ApartmentLayoutStore {
  return {
    async getLayout(uid) {
      const snap = await db.doc(FirestorePaths.apartmentLayout(uid)).get();
      if (!snap.exists) return null;
      const parsed = ApartmentLayoutSchema.safeParse(snap.data());
      if (!parsed.success) throw new CorruptLayoutError(uid, parsed.error);
      return parsed.data;
    },
    async saveLayout(uid, layout) {
      // Never write a document the schema (and so the next read) would reject.
      await db.doc(FirestorePaths.apartmentLayout(uid)).set(ApartmentLayoutSchema.parse(layout));
    },
  };
}

export function firestoreLayoutStoreFor(app: App): ApartmentLayoutStore {
  return createFirestoreLayoutStore(getFirestore(app));
}

/** An in-memory store for tests (and the shape the Firestore store must match). */
export interface MemoryLayoutStore extends ApartmentLayoutStore {
  readonly layouts: Map<string, ApartmentLayoutData>;
  /** How many saves reached the store. */
  saves: number;
}

export function createMemoryLayoutStore(initial: Record<string, ApartmentLayoutData> = {}): MemoryLayoutStore {
  const layouts = new Map(Object.entries(initial).map(([uid, l]) => [uid, cloneLayout(l)]));
  const store: MemoryLayoutStore = {
    layouts,
    saves: 0,
    async getLayout(uid) {
      const l = layouts.get(uid);
      return l ? cloneLayout(l) : null;
    },
    async saveLayout(uid, layout) {
      layouts.set(uid, cloneLayout(ApartmentLayoutSchema.parse(layout)));
      store.saves++;
    },
  };
  return store;
}
