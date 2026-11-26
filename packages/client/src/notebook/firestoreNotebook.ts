import { FirestorePaths, NotebookEntrySchema, type NotebookItem, type StreakState } from "@hellovalley/shared";
import { collection, doc, type Firestore, getDoc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import type { NotebookRepo } from "./notebook";

/** Entries mirrored per language (newest first; my number, far above a daily habit). */
export const NOTEBOOK_LOAD_MAX = 2000;

const millis = (t: { seconds: number; nanoseconds: number }) => t.seconds * 1000 + Math.floor(t.nanoseconds / 1e6);

/**
 * The notebook in Firestore (`users/{uid}/langs/{lang}/notebook/{id}`, firestore.rules: the owner
 * creates with `createdAt == request.time`, and every update sets `updatedAt == request.time`).
 * Every document read is parsed with the shared schema; one that does not parse is skipped.
 */
export function firestoreNotebookRepo(db: Firestore, uid: string): NotebookRepo {
  return {
    subscribe(lang, onItems, onError) {
      const q = query(collection(db, FirestorePaths.notebook(uid, lang)), orderBy("createdAt", "desc"), limit(NOTEBOOK_LOAD_MAX));
      return onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.flatMap((d): NotebookItem[] => {
            const parsed = NotebookEntrySchema.safeParse(d.data({ serverTimestamps: "estimate" }));
            if (!parsed.success) return [];
            const { createdAt, updatedAt: _updated, ...entry } = parsed.data;
            return [{ id: d.id, entry, createdMs: millis(createdAt) }];
          });
          onItems(items);
        },
        onError,
      );
    },
    async create(lang, id, entry) {
      await setDoc(doc(db, FirestorePaths.notebookEntry(uid, lang, id)), { ...entry, createdAt: serverTimestamp() });
    },
    async updateCard(lang, id, card) {
      await updateDoc(doc(db, FirestorePaths.notebookEntry(uid, lang, id)), { fsrs: card, updatedAt: serverTimestamp() });
    },
    async readStreak(lang): Promise<StreakState> {
      const data = (await getDoc(doc(db, FirestorePaths.lang(uid, lang)))).data();
      const streak = typeof data?.["streak"] === "number" ? data["streak"] : 0;
      const day = typeof data?.["streakDay"] === "number" ? data["streakDay"] : null;
      return { streak, day };
    },
  };
}
