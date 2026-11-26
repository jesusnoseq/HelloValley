import {
  type AiJsonSchema,
  compactionPrompt,
  type CompactionPromptInput,
  type CompactionResponse,
  contentKeyMaterial,
  detectLanguagePrompt,
  elderBarkPlayerMaterial,
  elderBarkPrompt,
  type ElderBarkPromptInput,
  type ElderBarkResponse,
  type FishId,
  glossPrompt,
  type GlossPromptInput,
  type GlossResponse,
  glossTaskFor,
  type GrammarFeedback,
  grammarFeedbackPrompt,
  type GrammarPromptInput,
  type HybridTask,
  type InferenceModeValue,
  type ModerationResponse,
  moderationPrompt,
  type OpenerPromptInput,
  parseTaskAnswer,
  personaliseOpenerPrompt,
  resolveMode,
  ROUTING_TABLE,
  TASK_SCHEMAS,
  type TaskOutput,
  translatePrompt,
  type TranslatePromptInput,
  translateTaskFor,
  LABELS_VERSION,
  worldLabelsPrompt,
  type WorldLabelsPromptInput,
  type WorldLabelsResponse,
} from "@hellovalley/shared";
import type { ContentCache } from "./cache";

/**
 * The hybrid AI module (build plan M20, GDD §9.2, architecture §5.2). Every small AI task is one
 * single-turn prompt (on-device Gemini Nano has no chat, no tools and no templates) with a tiny
 * JSON answer, sent through Firebase AI Logic hybrid inference with the task's `InferenceMode`
 * from the shared routing table. The answer is validated with zod and the call is retried once;
 * after that the task's fallback applies (the result says `ok: false`, and callers do the
 * fallback: show an "unavailable" chip, skip, rely on the server blocklist, keep the previous
 * summary, use the cached opener).
 *
 * The model is injected (`ModelPort`), so this file has no Firebase dependency and is tested with
 * a mocked model; `firebaseModel.ts` is the real port and `runtime.ts` wires the game's instance.
 * NPC dialogue turns (server prompt templates, cloud only) are in `templates.ts`.
 */

export type InferenceSourceName = "on-device" | "cloud";

export interface ModelRequest {
  task: HybridTask;
  mode: InferenceModeValue;
  prompt: string;
  /** Passed as both the cloud `responseSchema` and the on-device `responseConstraint`. */
  schema: AiJsonSchema;
  temperature: number;
}

export interface ModelAnswer {
  text: string;
  source: InferenceSourceName;
}

export type ModelPort = (request: ModelRequest) => Promise<ModelAnswer>;

export type TaskResult<T> =
  | { ok: true; value: T; source: InferenceSourceName | "cache" }
  /**
   * `unavailable`: no backend could run it (the fallback applied without a model call);
   * `failed`: the model was called and the answer stayed invalid after the retry.
   */
  | { ok: false; reason: "unavailable" | "failed" };

export interface HybridDeps {
  model: ModelPort;
  /** Is the on-device model downloaded and ready? Asked before each call. */
  onDeviceReady: () => boolean;
  /** A real Firebase project with AI Logic exists (false for the `demo-*` emulator project). */
  cloudEnabled: boolean;
  /** The per-player cache; without it nothing is cached. */
  cache?: ContentCache;
  /** Failure log (defaults to console.warn). */
  warn?: (message: string, error: unknown) => void;
}

/** Attempts per call: the first and one retry (npc-runtime.md conventions). */
export const MAX_ATTEMPTS = 2;

export type TranslateInput = TranslatePromptInput;

export interface ModerateInput {
  text: string;
  /** The sender before sending (may use the cloud) or a reader before display (on-device only). */
  side: "sender" | "reader";
}

export interface HybridAI {
  /** Tokenize + gloss a line (§5.1): on-device for ≤ 25 words, else cloud first. */
  gloss(input: GlossPromptInput): Promise<TaskResult<GlossResponse>>;
  /** Short translation (§5.2): on-device for ≤ 25 words, else cloud first. */
  translate(input: TranslateInput): Promise<TaskResult<{ translation: string }>>;
  /** Grammar feedback (§4.1): on-device only, skipped silently otherwise. */
  grammarFeedback(input: GrammarPromptInput): Promise<TaskResult<GrammarFeedback>>;
  /** Chat moderation (§6.1): `ok: false` in the result means "no verdict" (server blocklist only). */
  moderate(input: ModerateInput): Promise<TaskResult<ModerationResponse>>;
  /** Conversation compaction + level signals (§7): on failure keep the previous summary. */
  compactConversation(input: CompactionPromptInput): Promise<TaskResult<CompactionResponse>>;
  /** Opener personalisation (§3.1): on-device only; on failure use the cached opener. */
  personaliseOpener(input: OpenerPromptInput): Promise<TaskResult<{ text: string }>>;
  /** Language detection (§4.2): on failure keep the claimed language. */
  detectLanguage(text: string): Promise<TaskResult<{ lang: string }>>;
  /** World labels for one batch of keys (build plan M25): a seeded-cache miss, cloud first, per player. */
  worldLabels(input: WorldLabelsPromptInput): Promise<TaskResult<WorldLabelsResponse>>;
  /** The Elder's comments on a catch (build plan M27): a seeded-cache miss, cloud first, per player. */
  elderBark(input: ElderBarkPromptInput & { fishId: FishId }): Promise<TaskResult<ElderBarkResponse>>;
}

export function createHybridAI(deps: HybridDeps): HybridAI {
  const warn = deps.warn ?? ((message, error) => console.warn(message, error));
  // Concurrent identical requests share one model call.
  const inFlight = new Map<string, Promise<TaskResult<unknown>>>();

  async function run<T extends HybridTask>(task: T, prompt: string, key: string | null): Promise<TaskResult<TaskOutput<T>>> {
    const route = ROUTING_TABLE[task];
    const persist = route.cache === "persist";
    const cacheable = key !== null && route.cache !== "none" && deps.cache !== undefined;
    if (cacheable) {
      const hit = await deps.cache!.get(key, persist).catch(() => undefined);
      if (hit !== undefined) {
        // Cached values were validated when stored, but IndexedDB is outside our control: re-check.
        const parsed = TASK_SCHEMAS[task].zod.safeParse(hit);
        if (parsed.success) return { ok: true, value: parsed.data as TaskOutput<T>, source: "cache" };
      }
    }
    const mode = resolveMode(route.mode, { onDeviceReady: deps.onDeviceReady(), cloudEnabled: deps.cloudEnabled });
    if (mode === null) return { ok: false, reason: "unavailable" };
    const request: ModelRequest = { task, mode, prompt, schema: TASK_SCHEMAS[task].json, temperature: route.temperature };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const answer = await deps.model(request);
        const value = parseTaskAnswer(task, answer.text);
        if (cacheable) await deps.cache!.set(key, value, persist).catch(() => undefined);
        return { ok: true, value, source: answer.source };
      } catch (error) {
        if (attempt === MAX_ATTEMPTS) warn(`ai: ${task} failed after ${MAX_ATTEMPTS} attempts`, error);
      }
    }
    return { ok: false, reason: "failed" };
  }

  function shared<T extends HybridTask>(task: T, prompt: string, key: string | null): Promise<TaskResult<TaskOutput<T>>> {
    const id = `${task}\u0000${key ?? prompt}`;
    const pending = inFlight.get(id);
    if (pending) return pending as Promise<TaskResult<TaskOutput<T>>>;
    const p = run(task, prompt, key).finally(() => inFlight.delete(id));
    inFlight.set(id, p);
    return p;
  }

  return {
    gloss(input) {
      const task = glossTaskFor(input.text);
      // Glosses are in the reader's native language: the key's lang names the pair.
      const key = contentKeyMaterial({ kind: "gloss", lang: `${input.sourceLang}>${input.nativeLang}`, level: input.level, text: input.text });
      return shared(task, glossPrompt(input), key);
    },
    translate(input) {
      const task = translateTaskFor(input.text);
      const key = contentKeyMaterial({ kind: "translate", lang: `${input.from}>${input.to}`, text: input.text });
      return shared(task, translatePrompt(input), key);
    },
    grammarFeedback(input) {
      const key = contentKeyMaterial({
        kind: "grammarFeedback",
        lang: `${input.targetLang}>${input.nativeLang}`,
        level: input.level,
        text: `${input.listener ?? ""}\u0000${input.text}`,
      });
      return shared("grammarFeedback", grammarFeedbackPrompt(input), key);
    },
    moderate(input) {
      const task = input.side === "sender" ? "moderateOutgoing" : "moderateIncoming";
      return shared(task, moderationPrompt(input.text), contentKeyMaterial({ kind: "moderate", lang: "", text: input.text }));
    },
    compactConversation(input) {
      return shared("compactConversation", compactionPrompt(input), null);
    },
    personaliseOpener(input) {
      return shared("personaliseOpener", personaliseOpenerPrompt(input), null);
    },
    detectLanguage(text) {
      return shared("detectLanguage", detectLanguagePrompt(text), contentKeyMaterial({ kind: "detectLanguage", lang: "", text }));
    },
    worldLabels(input) {
      const keys = input.items.map((i) => `${i.key}=${i.english}`).join("|");
      const key = contentKeyMaterial({ kind: "worldLabels", lang: input.targetLang, level: `v${LABELS_VERSION}`, text: keys });
      return shared("worldLabels", worldLabelsPrompt(input), key);
    },
    elderBark(input) {
      return shared("elderBark", elderBarkPrompt(input), elderBarkPlayerMaterial(input.fishId, input.targetLang, input.nativeLang));
    },
  };
}
