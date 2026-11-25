import { FirestorePaths, LangSettingsSchema } from "@hellovalley/shared";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase/firestore";
import { scriptModeStore, setScriptModeSink } from "./scriptModeStore";

/**
 * Keeps the script toggle in `users/{uid}/langs/{lang}.settings.scriptMode` (GDD §6.1, §9.4), the
 * one langs field the client may write (firestore.rules). Loaded lazily after sign-in so the
 * Firestore SDK stays out of the entry chunk. Returns a function that stops the write-through.
 */
export function startScriptModeSync(uid: string, targetLangs: readonly string[]): () => void {
  let stopped = false;
  for (const lang of targetLangs) {
    getDoc(doc(db, FirestorePaths.lang(uid, lang)))
      .then((snap) => {
        const settings = LangSettingsSchema.safeParse(snap.data()?.["settings"] ?? {});
        const mode = settings.success ? settings.data.scriptMode : undefined;
        if (!stopped && mode) scriptModeStore.getState().hydrate(lang, mode);
      })
      .catch((e: unknown) => console.warn("script mode: could not read settings", lang, e));
  }
  setScriptModeSink((lang, mode) => {
    // Only languages the player learns have a langs doc (created by the server).
    if (!targetLangs.includes(lang)) return;
    updateDoc(doc(db, FirestorePaths.lang(uid, lang)), { "settings.scriptMode": mode }).catch((e: unknown) =>
      console.warn("script mode: could not save", lang, e),
    );
  });
  return () => {
    stopped = true;
    setScriptModeSink(null);
  };
}
