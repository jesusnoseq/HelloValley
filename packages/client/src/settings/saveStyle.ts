import { FirestorePaths, type StyleId } from "@hellovalley/shared";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/firestore";

/**
 * Save the town style to `users/{uid}.style`, one of the few profile fields the client may write
 * (firestore.rules `isAllowedProfileUpdate`, architecture §8.1). Loaded with the Settings panel so
 * the Firestore SDK stays out of the entry chunk.
 */
export function saveStyle(uid: string, style: StyleId): Promise<void> {
  return updateDoc(doc(db, FirestorePaths.user(uid)), { style });
}
