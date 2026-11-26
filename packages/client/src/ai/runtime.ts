import { firebaseApp, firebaseConfig } from "../firebase/app";
import { aiCloudEnabled } from "../firebase/config";
import { db } from "../firebase/firestore";
import { storage } from "../firebase/storage";
import { onDeviceReady, reportDownloadProgress, reportWarmUpDone } from "./availability";
import { createElderBarks, type ElderBarks } from "./barks";
import { type AiBudget, aiBudgetFor, currentAiBudget } from "./budget";
import { type AmbientBarks, createAmbientBarks } from "./ambient";
import { type ContentCache, createContentCache, createIdbStore, sha256Hex } from "./cache";
import { createFirebaseModelPort, createFirebaseTemplatePorts, createFirebaseTtsPort, sharedAi } from "./firebaseModel";
import { createHybridAI, type HybridAI } from "./hybrid";
import { type ChatModeration, hybridModeration } from "./moderation";
import { createOpeners, type Openers } from "./openers";
import { createQuestNotices, type QuestNotices } from "./questNotices";
import { createNpcTurnRunner, type NpcTurnRunner } from "./templates";
import { hybridTranslator, type Translator } from "./translate";
import { createTts, TTS_IDB_MAX_CLIPS, type TtsSpeaker } from "./tts";
import { createSeededTtsReader } from "./ttsSeeded";
import { doc, getDoc } from "firebase/firestore";
import { createLabelSource, type LabelSource, seededLabelsReader } from "../labels/labelSource";
import { FirestorePaths } from "@hellovalley/shared";

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
/** Build plan M36: the signed-in player's AI budget, looked up per call so a uid change applies. */
const budget: Pick<AiBudget, "allow" | "charge"> = {
  allow: (kind, amount) => currentAiBudget().allow(kind, amount),
  charge: (kind, amount) => currentAiBudget().charge(kind, amount),
};

/** What this device spent on AI since the last report (`ai:usage`, build plan M36). */
export const drainUsage = () => currentAiBudget().drain();

let uid: string | null = null;
let cache: ContentCache = createContentCache(null);
let instance: HybridAI | null = null;
let openerInstance: Openers | null = null;
let ttsInstance: TtsSpeaker | null = null;
let labelInstance: LabelSource | null = null;
let barkInstance: ElderBarks | null = null;
let noticeInstance: QuestNotices | null = null;
let ambientInstance: AmbientBarks | null = null;

export function setUser(next: string | null) {
  if (next === uid) return;
  uid = next;
  aiBudgetFor(next);
  cache = createContentCache(next ? createIdbStore(next) : null);
  instance = null;
  openerInstance = null;
  ttsInstance = null;
  labelInstance = null;
  barkInstance = null;
  noticeInstance = null;
  ambientInstance = null;
}

export function hybrid(): HybridAI {
  instance ??= createHybridAI({ model: firebase.port, onDeviceReady, cloudEnabled, cache, budget });
  return instance;
}

/** NPC dialogue turns through the `npc-turn` server prompt template (build plan M21). */
export const npcTurns: NpcTurnRunner = createNpcTurnRunner({ chat: templates.chat, cloudEnabled, budget });

/** Conversation openers, cached per player (build plan M21). */
export function openers(): Openers {
  openerInstance ??= createOpeners({
    generate: templates.generate,
    cloudEnabled,
    budget,
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
    budget,
    persistent: uid ? createIdbStore(uid, TTS_IDB_MAX_CLIPS, undefined, "hv-tts") : null,
    seeded: uid ? seededTts : null,
  });
  return ttsInstance;
}

/**
 * World labels (build plan M25): seeded `cache/labels/{lang}` (readable once signed in), then the
 * player's own generation of the missing keys through the hybrid `worldLabels` task.
 */
export function labels(): LabelSource {
  labelInstance ??= createLabelSource({
    seeded: uid
      ? seededLabelsReader(async (path) => {
          const snap = await getDoc(doc(db, path));
          return { exists: snap.exists(), data: snap.data() };
        })
      : async () => null,
    generate: (input) => hybrid().worldLabels(input),
  });
  return labelInstance;
}

/**
 * The Elder's catch comments (build plan M27): seeded `cache/lines/{hash}` (once signed in), then
 * the player's own generation through the hybrid `elderBark` task.
 */
export function elderBarks(): ElderBarks {
  barkInstance ??= createElderBarks({
    ...(uid
      ? {
          seeded: async (material: string) => {
            const snap = await getDoc(doc(db, FirestorePaths.cacheEntry("lines", await sha256Hex(material))));
            return snap.exists() ? snap.data() : null;
          },
        }
      : {}),
    generate: (input) => hybrid().elderBark(input),
  });
  return barkInstance;
}

/**
 * Request notices (build plan M30): seeded `cache/lines/{hash}` (once signed in), then the
 * player's own generation through the hybrid `questNotice` task.
 */
export function questNotices(): QuestNotices {
  noticeInstance ??= createQuestNotices({
    ...(uid
      ? {
          seeded: async (material: string) => {
            const snap = await getDoc(doc(db, FirestorePaths.cacheEntry("lines", await sha256Hex(material))));
            return snap.exists() ? snap.data() : null;
          },
        }
      : {}),
    generate: (input) => hybrid().questNotice(input),
  });
  return noticeInstance;
}

/**
 * Ambient barks (build plan M31): seeded `cache/lines/{hash}` (once signed in), then the player's
 * own generation through the hybrid `ambientBarks` task.
 */
export function ambientBarks(): AmbientBarks {
  ambientInstance ??= createAmbientBarks({
    ...(uid
      ? {
          seeded: async (material: string) => {
            const snap = await getDoc(doc(db, FirestorePaths.cacheEntry("lines", await sha256Hex(material))));
            return snap.exists() ? snap.data() : null;
          },
        }
      : {}),
    generate: (input) => hybrid().ambientBarks(input),
  });
  return ambientInstance;
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
