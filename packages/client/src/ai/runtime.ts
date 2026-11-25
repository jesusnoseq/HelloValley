import { firebaseApp, firebaseConfig } from "../firebase/app";
import { aiCloudEnabled } from "../firebase/config";
import { db } from "../firebase/firestore";
import { storage } from "../firebase/storage";
import { onDeviceReady, reportDownloadProgress, reportWarmUpDone } from "./availability";
import { type ContentCache, createContentCache, createIdbStore } from "./cache";
import { createFirebaseModelPort, createFirebaseTemplatePorts, createFirebaseTtsPort, sharedAi } from "./firebaseModel";
import { createHybridAI, type HybridAI } from "./hybrid";
import { type ChatModeration, hybridModeration } from "./moderation";
import { createOpeners, type Openers } from "./openers";
import { createNpcTurnRunner, type NpcTurnRunner } from "./templates";
import { hybridTranslator, type Translator } from "./translate";
import { createTts, TTS_IDB_MAX_CLIPS, type TtsSpeaker } from "./tts";
import { createSeededTtsReader } from "./ttsSeeded";

/**
 * The game's hybrid AI instance (a lazy chunk: it carries `firebase/ai` and the shared zod
 * schemas, so `ai/client.ts` loads it on first use). The per-player cache follows the signed-in
 * uid (`setUser`); before sign-in, answers are cached in memory only.
 */
const getAi = sharedAi(firebaseApp);
const firebase = createFirebaseModelPort(firebaseApp, getAi);
const templates = createFirebaseTemplatePorts(getAi);
const ttsPort = createFirebaseTtsPort(getAi);
const seededTts = createSeededTtsReader(db, storage);
const cloudEnabled = aiCloudEnabled(firebaseConfig.options);

let uid: string | null = null;
let cache: ContentCache = createContentCache(null);
let instance: HybridAI | null = null;
let openerInstance: Openers | null = null;
let ttsInstance: TtsSpeaker | null = null;

export function setUser(next: string | null) {
  if (next === uid) return;
  uid = next;
  cache = createContentCache(next ? createIdbStore(next) : null);
  instance = null;
  openerInstance = null;
  ttsInstance = null;
}

export function hybrid(): HybridAI {
  instance ??= createHybridAI({ model: firebase.port, onDeviceReady, cloudEnabled, cache });
  return instance;
}

/** NPC dialogue turns through the `npc-turn` server prompt template (build plan M21). */
export const npcTurns: NpcTurnRunner = createNpcTurnRunner({ chat: templates.chat, cloudEnabled });

/** Conversation openers, cached per player (build plan M21). */
export function openers(): Openers {
  openerInstance ??= createOpeners({
    generate: templates.generate,
    cloudEnabled,
    cache,
    personalise: (input) => hybrid().personaliseOpener(input),
    gloss: (input) => hybrid().gloss(input),
  });
  return openerInstance;
}

/**
 * NPC voices (build plan M22): memory, seeded `cache/tts`, then the player's own IndexedDB
 * (`hv-tts-{uid}`), then Gemini TTS. Before sign-in clips stay in memory (and seeded clips are
 * not readable: Storage needs a signed-in user).
 */
export function tts(): TtsSpeaker {
  ttsInstance ??= createTts({
    port: ttsPort,
    cloudEnabled,
    persistent: uid ? createIdbStore(uid, TTS_IDB_MAX_CLIPS, undefined, "hv-tts") : null,
    seeded: uid ? seededTts : null,
  });
  return ttsInstance;
}

// Adapters for the M18 chat hooks; they look the instance up per call, so a uid change applies.
export const translator: Translator = hybridTranslator({ translate: (input) => hybrid().translate(input) });
export const moderation: ChatModeration = hybridModeration({ moderate: (input) => hybrid().moderate(input) });

let warming: Promise<void> | null = null;

/**
 * Starts (or joins) the on-device model download. Call it from a user gesture: Chrome refuses
 * to start a download without one. Failures leave the status to the Prompt API's answer.
 */
export function warmUp(): Promise<void> {
  warming ??= firebase
    .initializeDeviceModel(reportDownloadProgress)
    .then(() => reportWarmUpDone(true))
    .catch((error: unknown) => {
      console.warn("ai: on-device warm-up failed", error);
      reportWarmUpDone(false);
      warming = null;
    });
  return warming;
}
