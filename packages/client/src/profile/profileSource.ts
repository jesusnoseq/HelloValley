import { FirestorePaths, type PlayerProfile } from "@hellovalley/shared";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/firestore";
import { parseProfileDoc } from "./parseProfile";

/**
 * Reads the signed-in player's own `users/{uid}` (architecture §8.1: owner read). Loaded lazily by
 * the profile gate so the Firestore SDK stays out of the entry chunk.
 */
export async function loadProfile(uid: string): Promise<PlayerProfile | null> {
  const snap = await getDoc(doc(db, FirestorePaths.user(uid)));
  return parseProfileDoc(snap.exists() ? snap.data() : null);
}
