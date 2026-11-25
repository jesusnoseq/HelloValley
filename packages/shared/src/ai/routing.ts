/**
 * The hybrid AI routing table (GDD §9.2, overridden by architecture §5.2), as data. The client's
 * `ai/hybrid.ts` runs every task through Firebase AI Logic hybrid inference with the mode given
 * here. On-device (Gemini Nano) is single-turn only, with no chat, tools or templates, so every
 * task is one short prompt with a small JSON answer (npc-runtime.md §On-device), validated with
 * zod and retried once. When it still fails, the task's `fallback` applies.
 *
 * The mode strings are Firebase AI Logic's `InferenceMode` values (shared has no Firebase
 * dependency, so they are repeated here; a client test checks they match).
 */

export const INFERENCE_MODES = {
  PREFER_ON_DEVICE: "prefer_on_device",
  ONLY_ON_DEVICE: "only_on_device",
  ONLY_IN_CLOUD: "only_in_cloud",
  PREFER_IN_CLOUD: "prefer_in_cloud",
} as const;
export type InferenceModeValue = (typeof INFERENCE_MODES)[keyof typeof INFERENCE_MODES];

export const HYBRID_TASKS = [
  "gloss",
  "glossLong",
  "translateShort",
  "translateLong",
  "grammarFeedback",
  "moderateOutgoing",
  "moderateIncoming",
  "compactConversation",
  "personaliseOpener",
  "detectLanguage",
] as const;
export type HybridTask = (typeof HYBRID_TASKS)[number];

/**
 * What the caller does when the task gives no answer (after the SDK's own on-device ↔ cloud
 * fallback of the PREFER_* modes and the one retry):
 * - `unavailable-chip`: show the text without it, with an "unavailable" chip;
 * - `skip`: the optional feature silently does nothing;
 * - `server-blocklist`: not flagged here (the game server's mandatory check still runs);
 * - `keep-previous`: keep the previous NPC memory summary;
 * - `cached-opener`: use the cached opener unchanged;
 * - `assume-claimed`: keep the language the sender claimed.
 */
export type TaskFallback = "unavailable-chip" | "skip" | "server-blocklist" | "keep-previous" | "cached-opener" | "assume-claimed";

/**
 * Where answers are cached (architecture §8.3): `persist` = memory LRU + the player's own
 * IndexedDB; `memory` = this session only; `none` = never (the input is unique or personal).
 * Play-time answers are never written to the shared Firestore `cache/*` (architecture §6.3).
 */
export type TaskCache = "persist" | "memory" | "none";

export interface TaskRoute {
  mode: InferenceModeValue;
  fallback: TaskFallback;
  cache: TaskCache;
  /** Generation temperature for the cloud model (low: these are lookups, not writing). */
  temperature: number;
}

const M = INFERENCE_MODES;

export const ROUTING_TABLE: Readonly<Record<HybridTask, TaskRoute>> = {
  // Architecture §5.2 row 1: ≤ 25 words on-device first, cloud flash-lite automatically.
  gloss: { mode: M.PREFER_ON_DEVICE, fallback: "unavailable-chip", cache: "persist", temperature: 0.2 },
  translateShort: { mode: M.PREFER_ON_DEVICE, fallback: "unavailable-chip", cache: "persist", temperature: 0.2 },
  // Row 2: long text (P2P chat ≥ 25 words) in the cloud first, on-device as the fallback.
  glossLong: { mode: M.PREFER_IN_CLOUD, fallback: "unavailable-chip", cache: "persist", temperature: 0.2 },
  translateLong: { mode: M.PREFER_IN_CLOUD, fallback: "unavailable-chip", cache: "persist", temperature: 0.2 },
  // Row 3: optional, on-device only.
  grammarFeedback: { mode: M.ONLY_ON_DEVICE, fallback: "skip", cache: "memory", temperature: 0.2 },
  // Rows 4–5: the sender may use the cloud; the reader checks on-device only (cost: every reader).
  moderateOutgoing: { mode: M.PREFER_ON_DEVICE, fallback: "server-blocklist", cache: "memory", temperature: 0 },
  moderateIncoming: { mode: M.ONLY_ON_DEVICE, fallback: "server-blocklist", cache: "memory", temperature: 0 },
  // Row 6: background, after a conversation. GDD §9.2's "server does it in cloud" fallback is
  // the SDK's own PREFER_ON_DEVICE → cloud fallback (the game server never calls a model,
  // architecture §1); the server only validates and caps the result (`npc:memory`, build plan M24).
  compactConversation: { mode: M.PREFER_ON_DEVICE, fallback: "keep-previous", cache: "none", temperature: 0.3 },
  // Row 7: optional polish over a cached opener.
  personaliseOpener: { mode: M.ONLY_ON_DEVICE, fallback: "cached-opener", cache: "none", temperature: 0.5 },
  // npc-runtime.md §4.2 (native-language redirect, chat language).
  detectLanguage: { mode: M.PREFER_ON_DEVICE, fallback: "assume-claimed", cache: "memory", temperature: 0 },
};

/** Architecture §5.2: text up to this many words is "short" (on-device first). */
export const SHORT_TEXT_MAX_WORDS = 25;

/**
 * Words in a text. Scripts without spaces (Japanese, Chinese, Thai…) are counted with
 * `Intl.Segmenter`, so a long Japanese line is not one "word".
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    let n = 0;
    for (const s of new Intl.Segmenter(undefined, { granularity: "word" }).segment(trimmed)) if (s.isWordLike) n++;
    return n;
  }
  return trimmed.split(/\s+/).length;
}

export const isShortText = (text: string) => countWords(text) <= SHORT_TEXT_MAX_WORDS;

/** The gloss or translation task for a text, by length. */
export const glossTaskFor = (text: string): "gloss" | "glossLong" => (isShortText(text) ? "gloss" : "glossLong");
export const translateTaskFor = (text: string): "translateShort" | "translateLong" => (isShortText(text) ? "translateShort" : "translateLong");

export interface ModeContext {
  /** The on-device model is downloaded and ready (`LanguageModel.availability() === "available"`). */
  onDeviceReady: boolean;
  /** A real Firebase project with AI Logic is configured (not the `demo-*` emulator project). */
  cloudEnabled: boolean;
}

/**
 * The mode actually requested for a task, or `null` when it cannot run at all (the fallback then
 * applies at once, without a model call). ONLY_ON_DEVICE needs a ready model (the SDK would throw);
 * without a cloud backend the PREFER modes become ONLY_ON_DEVICE.
 */
export function resolveMode(mode: InferenceModeValue, ctx: ModeContext): InferenceModeValue | null {
  if (!ctx.cloudEnabled) {
    if (mode === M.ONLY_IN_CLOUD) return null;
    return ctx.onDeviceReady ? M.ONLY_ON_DEVICE : null;
  }
  if (mode === M.ONLY_ON_DEVICE && !ctx.onDeviceReady) return null;
  return mode;
}
