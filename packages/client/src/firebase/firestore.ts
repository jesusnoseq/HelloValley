import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { firebaseApp, firebaseConfig } from "./app";

/**
 * Firestore for the client. Build document paths with `FirestorePaths` and parse what you read
 * with the zod schemas from `@hellovalley/shared`. The client writes only its own profile
 * appearance, language settings and notebook; `firestore.rules` rejects everything else
 * (architecture §8.1).
 * The profile gate reads `users/{uid}` (profile/profileSource). TODO(M15): appearance writes from
 * the mirror. The notebook reads and writes its entries in notebook/firestoreNotebook.ts (M25).
 */
export const db = getFirestore(firebaseApp);

if (firebaseConfig.emulators) {
  const { host, port } = firebaseConfig.emulators.firestore;
  connectFirestoreEmulator(db, host, port);
}
