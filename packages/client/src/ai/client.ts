import { aiStatusStore, refreshOnDeviceStatus } from "./availability";
import type { GrammarFeedback, GrammarPromptInput } from "@hellovalley/shared";
import type { NpcAi } from "../net/npcConversation";
import type { TaskResult } from "./hybrid";
import type { ChatModeration } from "./moderation";
import type { TranslateResult, Translator } from "./translate";
import type { TtsResult, TtsSpeaker } from "./tts";

/**
 * Entry-chunk access to the AI module. The runtime (Firebase AI Logic, zod) is a lazy chunk
 * loaded on first use, so the first screen does not download it (GDD §9.5).
 */
type Runtime = typeof import("./runtime");
let runtime: Promise<Runtime> | null = null;
let user: string | null = null;

export function loadAiRuntime(): Promise<Runtime> {
  runtime ??= import("./runtime").then((r) => {
    r.setUser(user);
    return r;
  });
  return runtime;
}

/** The signed-in player, whose IndexedDB holds their cached answers. */
export function setAiUser(uid: string | null) {
  user = uid;
  void runtime?.then((r) => r.setUser(uid));
}

export const lazyTranslator: Translator = {
  translate: (request) =>
    loadAiRuntime()
      .then((r) => r.translator.translate(request))
      .catch((): TranslateResult => ({ ok: false, reason: "failed" })),
};

export const lazyModeration: ChatModeration = {
  checkOutgoing: (text, lang) =>
    loadAiRuntime()
      .then((r) => r.moderation.checkOutgoing(text, lang))
      .catch(() => ({ flagged: false }) as const),
  checkIncoming: (text, lang) =>
    loadAiRuntime()
      .then((r) => r.moderation.checkIncoming(text, lang))
      .catch(() => ({ flagged: false }) as const),
};

/**
 * The warm-up (architecture §5.2): if the model is `downloadable`, start the download. Call it
 * from a click or key handler (the Prompt API needs a user gesture); preload the runtime earlier
 * (`loadAiRuntime`) so the gesture is still active when the download starts.
 */
export function startWarmUp() {
  const { onDevice, progress } = aiStatusStore.getState();
  if (onDevice !== "downloadable" || progress !== null) return;
  void loadAiRuntime()
    .then((r) => r.warmUp())
    .catch(() => undefined);
}

/** At login: ask the Prompt API, and preload the runtime when there is something to warm up. */
export async function checkOnDeviceAtLogin(): Promise<void> {
  const status = await refreshOnDeviceStatus();
  if (status === "downloadable") void loadAiRuntime().catch(() => undefined);
}

/** NPC turns and openers from the lazy runtime (build plan M21), for `NpcConversation` (the M23 conversation panel). */
export async function loadNpcAi(): Promise<NpcAi> {
  const r = await loadAiRuntime();
  return {
    run: (input) => r.npcTurns.run(input),
    canned: (kind, context) => r.npcTurns.canned(kind, context),
    opener: (context, playerName) => r.openers().get(context, playerName),
  };
}

/**
 * The conversation panel's input helpers (build plan M23, npc-runtime.md §4): on-device grammar
 * feedback (skipped when unavailable) and language detection for the native-language redirect.
 */
export interface InputHelpers {
  grammarFeedback(input: GrammarPromptInput): Promise<TaskResult<GrammarFeedback>>;
  detectLanguage(text: string): Promise<TaskResult<{ lang: string }>>;
}

export async function loadInputHelpers(): Promise<InputHelpers> {
  const r = await loadAiRuntime();
  return {
    grammarFeedback: (input) => r.hybrid().grammarFeedback(input),
    detectLanguage: (text) => r.hybrid().detectLanguage(text),
  };
}

/** NPC voices from the lazy runtime (build plan M22); a failure leaves the line text only. */
export const lazyTts: TtsSpeaker = {
  clip: (line) =>
    loadAiRuntime()
      .then((r) => r.tts().clip(line))
      .catch((): TtsResult => ({ ok: false, reason: "failed" })),
};
