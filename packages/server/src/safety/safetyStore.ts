import type { App } from "firebase-admin/app";
import { type Firestore, getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  type BlockedPlayer,
  BlockListSchema,
  ChatReportDocSchema,
  type ChatReportInput,
  ChatReportInputSchema,
  emptyStanding,
  FirestorePaths,
  type ModerationStanding,
  ModerationStandingSchema,
} from "@hellovalley/shared";

/**
 * Player safety data (build plan M18, architecture §6.4): block lists, kept across sessions in
 * `users/{uid}/safety/blocks`, player reports in `reports/{id}`, and (build plan M36) each
 * player's strikes and shard-wide mute in `users/{uid}/safety/standing`. All are server-only (no
 * security rule matches them, so clients can neither read nor write them); the Admin SDK
 * bypasses the rules. Personal mutes live only in the TownRoom session.
 */
export interface SafetyStore {
  /** The players `uid` blocked (empty when none). */
  getBlocks(uid: string): Promise<BlockedPlayer[]>;
  /** Replaces the block list of `uid`. */
  saveBlocks(uid: string, players: BlockedPlayer[]): Promise<void>;
  /** Files a report; returns its id. */
  addReport(report: ChatReportInput): Promise<string>;
  /** The player's strikes and shard-wide mute (build plan M36); an empty standing when none. */
  getStanding(uid: string): Promise<ModerationStanding>;
  saveStanding(uid: string, standing: ModerationStanding): Promise<void>;
}

export function createFirestoreSafetyStore(db: Firestore): SafetyStore {
  return {
    async getBlocks(uid) {
      const snap = await db.doc(FirestorePaths.blockList(uid)).get();
      if (!snap.exists) return [];
      const parsed = BlockListSchema.safeParse(snap.data());
      if (!parsed.success) {
        console.warn(`[safety] users/${uid}/safety/blocks does not match BlockListSchema; treating it as empty`);
        return [];
      }
      return parsed.data.players;
    },
    async saveBlocks(uid, players) {
      await db.doc(FirestorePaths.blockList(uid)).set(BlockListSchema.parse({ players }));
    },
    async addReport(report) {
      const ref = db.collection(FirestorePaths.reports()).doc();
      await ref.set(ChatReportDocSchema.parse({ ...report, createdAt: Timestamp.now() }));
      return ref.id;
    },
    async getStanding(uid) {
      const snap = await db.doc(FirestorePaths.standing(uid)).get();
      if (!snap.exists) return emptyStanding();
      const parsed = ModerationStandingSchema.safeParse(snap.data());
      if (!parsed.success) {
        console.warn(`[safety] users/${uid}/safety/standing does not match ModerationStandingSchema; treating it as empty`);
        return emptyStanding();
      }
      return parsed.data;
    },
    async saveStanding(uid, standing) {
      await db.doc(FirestorePaths.standing(uid)).set(ModerationStandingSchema.parse(standing));
    },
  };
}

export function firestoreSafetyStoreFor(app: App): SafetyStore {
  return createFirestoreSafetyStore(getFirestore(app));
}

/** An in-memory store for tests (and the shape the Firestore store must match). */
export interface MemorySafetyStore extends SafetyStore {
  readonly blocks: Map<string, BlockedPlayer[]>;
  readonly reports: ChatReportInput[];
  readonly standings: Map<string, ModerationStanding>;
}

export function createMemorySafetyStore(initial: Record<string, BlockedPlayer[]> = {}): MemorySafetyStore {
  const blocks = new Map(Object.entries(initial).map(([uid, list]) => [uid, list.map((p) => ({ ...p }))]));
  const reports: ChatReportInput[] = [];
  const standings = new Map<string, ModerationStanding>();
  return {
    blocks,
    reports,
    standings,
    async getBlocks(uid) {
      return (blocks.get(uid) ?? []).map((p) => ({ ...p }));
    },
    async saveBlocks(uid, players) {
      blocks.set(uid, BlockListSchema.parse({ players }).players);
    },
    async addReport(report) {
      reports.push(ChatReportInputSchema.parse(report));
      return `report-${reports.length}`;
    },
    async getStanding(uid) {
      return structuredClone(standings.get(uid) ?? emptyStanding());
    },
    async saveStanding(uid, standing) {
      standings.set(uid, ModerationStandingSchema.parse(standing));
    },
  };
}
