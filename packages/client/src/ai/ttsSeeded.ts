import { CachedTtsSchema, FirestorePaths, ttsStoragePath } from "@hellovalley/shared";
import { doc, type Firestore, getDoc } from "firebase/firestore";
import { type FirebaseStorage, getBytes, ref } from "firebase/storage";
import type { SeededTtsReader, TtsClip } from "./tts";

/** Largest seeded clip read (`storage.rules` caps uploads at 1 MB). */
const MAX_SEEDED_BYTES = 1024 * 1024;

/**
 * Seeded clips (architecture §5.4 step 2, §8.2): `cache/tts/{hash}` names the Storage clip
 * `tts/{hash}.ogg`, written only by the admin seeding tool (`tools/seed/seed-tts.ts`). The doc is
 * validated, and must point at the clip of its own hash in the expected voice; anything else is a
 * miss, and the caller generates the line itself. Only signed-in players can read either.
 */
export function createSeededTtsReader(db: Firestore, storage: FirebaseStorage): SeededTtsReader {
  return {
    async get(hash, voice): Promise<TtsClip | null> {
      try {
        const snap = await getDoc(doc(db, FirestorePaths.cacheEntry("tts", hash)));
        if (!snap.exists()) return null;
        const entry = CachedTtsSchema.safeParse(snap.data());
        if (!entry.success || entry.data.storagePath !== ttsStoragePath(hash) || entry.data.voice !== voice) return null;
        const data = await getBytes(ref(storage, entry.data.storagePath), MAX_SEEDED_BYTES);
        return data.byteLength > 0 ? { mime: "audio/ogg", data, durationMs: entry.data.durationMs } : null;
      } catch {
        return null;
      }
    },
  };
}
