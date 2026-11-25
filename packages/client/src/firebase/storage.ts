import { connectStorageEmulator, getStorage } from "firebase/storage";
import { firebaseApp, firebaseConfig } from "./app";

/**
 * Cloud Storage for the client: seeded TTS clips under `tts/{hash}.ogg` (read-only, architecture §8.2).
 * TODO(M22): load seeded clips through the cache layers.
 */
export const storage = getStorage(firebaseApp);

if (firebaseConfig.emulators) {
  const { host, port } = firebaseConfig.emulators.storage;
  connectStorageEmulator(storage, host, port);
}
