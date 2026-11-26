import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  FirestorePaths,
  parseVillagePayload,
  type TimestampLike,
  VILLAGE_EVENT_TTL_DAYS,
  type VillageEventRecord,
  VillageEventSchema,
  VillagePrivacySchema,
} from "@hellovalley/shared";

/**
 * What village memory reads and writes (build plan M31, GDD §8.2, architecture §8.1): the public
 * event log `village/{shardId}/events/{id}` (TTL 14 days through a Firestore TTL policy on
 * `expiresAt`; signed-in players may read it, only the server writes it) and each player's news
 * setting `users/{uid}/privacy/village` (no security rule matches it, so it is server-only; the
 * room sends and changes it).
 */
export interface VillageStore {
  append(shardId: string, event: VillageEventRecord): Promise<void>;
  /** The shard's events since `sinceMs`, newest first, at most `limit`. */
  recent(shardId: string, sinceMs: number, limit: number): Promise<VillageEventRecord[]>;
  /** The player's setting, or null when they never chose (named, the GDD's opt-out). */
  privacy(uid: string): Promise<boolean | null>;
  setPrivacy(uid: string, named: boolean): Promise<void>;
}

const millis = (t: TimestampLike) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);
const TTL_MS = VILLAGE_EVENT_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Firestore through the Admin SDK (bypasses the security rules). */
export function createFirestoreVillageStore(db: Firestore): VillageStore {
  return {
    async append(shardId, e) {
      const doc = {
        type: e.type,
        ...(e.actorName ? { actorName: e.actorName } : {}),
        payload: e.payload,
        ts: Timestamp.fromMillis(e.ts),
        expiresAt: Timestamp.fromMillis(e.ts + TTL_MS),
      };
      // Validate before writing, so the log never holds a document the schema rejects.
      VillageEventSchema.parse(doc);
      await db.doc(FirestorePaths.villageEvent(shardId, e.id)).set(doc);
    },
    async recent(shardId, sinceMs, limit) {
      // A single-field range + order on `ts` is served by the automatic index.
      const snap = await db.collection(FirestorePaths.villageEvents(shardId)).where("ts", ">=", Timestamp.fromMillis(sinceMs)).orderBy("ts", "desc").limit(limit).get();
      const out: VillageEventRecord[] = [];
      for (const d of snap.docs) {
        const parsed = VillageEventSchema.safeParse(d.data());
        if (!parsed.success) continue;
        const body = parseVillagePayload(parsed.data.type, parsed.data.payload);
        if (!body) continue;
        out.push({ id: d.id, ...body, ...(parsed.data.actorName ? { actorName: parsed.data.actorName } : {}), ts: millis(parsed.data.ts) } as VillageEventRecord);
      }
      return out;
    },
    async privacy(uid) {
      const snap = await db.doc(FirestorePaths.villagePrivacy(uid)).get();
      if (!snap.exists) return null;
      const parsed = VillagePrivacySchema.safeParse(snap.data());
      return parsed.success ? parsed.data.named : null;
    },
    async setPrivacy(uid, named) {
      await db.doc(FirestorePaths.villagePrivacy(uid)).set(VillagePrivacySchema.parse({ named }));
    },
  };
}

export function firestoreVillageStoreFor(app: App): VillageStore {
  return createFirestoreVillageStore(getFirestore(app));
}

/** An in-memory store for tests (and the shape the Firestore store must match). */
export interface MemoryVillageStore extends VillageStore {
  readonly events: Map<string, VillageEventRecord[]>;
  readonly privacies: Map<string, boolean>;
}

export function createMemoryVillageStore(): MemoryVillageStore {
  const events = new Map<string, VillageEventRecord[]>();
  const privacies = new Map<string, boolean>();
  return {
    events,
    privacies,
    async append(shardId, e) {
      events.set(shardId, [...(events.get(shardId) ?? []), structuredClone(e)]);
    },
    async recent(shardId, sinceMs, limit) {
      return (events.get(shardId) ?? [])
        .filter((e) => e.ts >= sinceMs)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit)
        .map((e) => structuredClone(e));
    },
    async privacy(uid) {
      return privacies.get(uid) ?? null;
    },
    async setPrivacy(uid, named) {
      privacies.set(uid, named);
    },
  };
}
