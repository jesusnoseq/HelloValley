import { connectStorageEmulator, getStorage } from "firebase/storage";
import { firebaseApp, firebaseConfig } from "./app";

/**
 * Cloud Storage for the client: seeded TTS clips under `tts/{hash}.ogg` (read-only, architecture §8.2).
 * Read through the TTS cache layers (`ai/ttsSeeded.ts`, build plan M22).
 */
export const storage = getStorage(firebaseApp);

if (firebaseConfig.emulators) {
  const { host, port } = firebaseConfig.emulators.storage;
  connectStorageEmulator(storage, host, port);
}
