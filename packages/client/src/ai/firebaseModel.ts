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
  type TemplateGenerativeModel,
} from "firebase/ai";
import { MODEL_IDS, ROUTING_TABLE, TASK_SCHEMAS } from "@hellovalley/shared";
import type { ModelPort, ModelRequest } from "./hybrid";
import type { TemplateChatPort, TemplateGeneratePort } from "./templates";

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
 * The real model port: Firebase AI Logic hybrid inference with the Gemini Developer API backend
 * (architecture §3.2). One `GenerativeModel` per task and mode, because the on-device params
 * (the response constraint) are fixed for an instance's lifetime. The task's JSON schema goes to
 * both `inCloudParams.generationConfig.responseSchema` and
 * `onDeviceParams.promptOptions.responseConstraint` (architecture §5.2).
 *
 * `expectedInputs`/`expectedOutputs` languages are not set: Chrome's Prompt API supports only a
 * few output languages, and naming another one makes the model unavailable for the whole task.
 * TODO(M36): App Check (reCAPTCHA Enterprise) before AI Logic is enforced.
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
