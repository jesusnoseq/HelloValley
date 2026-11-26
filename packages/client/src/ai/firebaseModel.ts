import type { FirebaseApp } from "firebase/app";
import {
  type AI,
  type GenerativeModel,
  getAI,
  getGenerativeModel,
  getTemplateGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  ResponseModality,
  type TemplateGenerativeModel,
} from "firebase/ai";
import { MODEL_IDS, ROUTING_TABLE, TASK_SCHEMAS } from "@hellovalley/shared";
import type { ModelPort, ModelRequest } from "./hybrid";
import { base64ToBytes } from "./pcm";
import type { TemplateChatPort, TemplateGeneratePort } from "./templates";
import type { TtsPort } from "./tts";

/** One AI Logic instance per app (Gemini Developer API backend, architecture §3.2). */
function sharedAi(app: FirebaseApp): () => AI {
  let ai: AI | null = null;
  return () => (ai ??= getAI(app, { backend: new GoogleAIBackend() }));
}

/**
 * Server prompt template calls (architecture §5.3): NPC turns through a template chat session
 * (`startChat` with the trimmed history, then `sendMessageStream`, so text streams in), and
 * openers through a single `generateContent`. Templates are cloud only (no hybrid inference).
 */
export function createFirebaseTemplatePorts(getAi: () => AI): { chat: TemplateChatPort; generate: TemplateGeneratePort } {
  let model: TemplateGenerativeModel | null = null;
  const templates = () => (model ??= getTemplateGenerativeModel(getAi()));
  return {
    async *chat(request) {
      const session = templates().startChat({
        templateId: request.templateId,
        templateVariables: request.variables,
        history: request.history.map((h) => ({ role: h.role, parts: [{ type: "text" as const, text: h.text }] })),
      });
      const result = await session.sendMessageStream(request.message, { signal: request.signal });
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
    },
    async generate(request) {
      const result = await templates().generateContent({ templateId: request.templateId, templateVariables: request.variables });
      return result.response.text();
    },
  };
}

export { sharedAi };

/**
 * Gemini TTS through AI Logic (build plan M22, architecture §5.4): one `GenerativeModel` per
 * prebuilt voice with `responseModalities: [AUDIO]`. The NPC's style goes in the text part's
 * `speechMetadata.style` (npc-runtime.md §10), and the transcript keeps its inline tags. No
 * `languageCode`: the model detects the language. A unary call; the text is already on screen.
 * App Check (build plan M36) is attached by the SDK: `firebase/app.ts` starts it before `getAI`.
 */
export function createFirebaseTtsPort(getAi: () => AI): TtsPort {
  const models = new Map<string, GenerativeModel>();
  const modelFor = (model: string, voiceName: string) => {
    const id = `${model}:${voiceName}`;
    let m = models.get(id);
    if (!m) {
      m = getGenerativeModel(getAi(), {
        model,
        generationConfig: {
          responseModalities: [ResponseModality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      });
      models.set(id, m);
    }
    return m;
  };
  return async (request) => {
    const result = await modelFor(request.model, request.voiceName).generateContent([
      { type: "text", text: request.transcript, speechMetadata: { style: request.style } },
    ]);
    const parts = result.response.inlineDataParts() ?? [];
    const audio = parts.filter((p) => p.inlineData.mimeType.toLowerCase().startsWith("audio/"));
    if (audio.length === 0) throw new Error("tts: no audio in the response");
    const chunks = audio.map((p) => base64ToBytes(p.inlineData.data));
    const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      data.set(c, at);
      at += c.length;
    }
    return { mime: audio[0]!.inlineData.mimeType, data };
  };
}

/**
 * The real model port: Firebase AI Logic hybrid inference with the Gemini Developer API backend
 * (architecture §3.2). One `GenerativeModel` per task and mode, because the on-device params
 * (the response constraint) are fixed for an instance's lifetime. The task's JSON schema goes to
 * both `inCloudParams.generationConfig.responseSchema` and
 * `onDeviceParams.promptOptions.responseConstraint` (architecture §5.2).
 *
 * `expectedInputs`/`expectedOutputs` languages are not set: Chrome's Prompt API supports only a
 * few output languages, and naming another one makes the model unavailable for the whole task.
 * App Check (reCAPTCHA Enterprise, build plan M36) tokens are attached by the SDK.
 */
export function createFirebaseModelPort(app: FirebaseApp, getAi: () => AI = sharedAi(app)): { port: ModelPort; initializeDeviceModel(onProgress: (p: number) => void): Promise<void> } {
  const models = new Map<string, GenerativeModel>();

  const modelFor = (r: Pick<ModelRequest, "task" | "mode" | "schema" | "temperature">) => {
    const id = `${r.task}:${r.mode}`;
    let model = models.get(id);
    if (!model) {
      model = getGenerativeModel(getAi(), {
        mode: r.mode,
        inCloudParams: {
          model: MODEL_IDS.cloudFallback,
          generationConfig: { responseMimeType: "application/json", responseSchema: r.schema, temperature: r.temperature },
        },
        onDeviceParams: { promptOptions: { responseConstraint: r.schema } },
      });
      models.set(id, model);
    }
    return model;
  };

  return {
    async port(request) {
      const result = await modelFor(request).generateContent(request.prompt);
      return {
        text: result.response.text(),
        source: result.response.inferenceSource === InferenceSource.ON_DEVICE ? "on-device" : "cloud",
      };
    },
    // Must run on or after a user gesture when a download is needed (Prompt API rule).
    initializeDeviceModel(onProgress) {
      // The same instance the short translations use, so its session is warm too.
      const model = modelFor({
        task: "translateShort",
        mode: InferenceMode.PREFER_ON_DEVICE,
        schema: TASK_SCHEMAS.translateShort.json,
        temperature: ROUTING_TABLE.translateShort.temperature,
      });
      return model.initializeDeviceModel(onProgress);
    },
  };
}
