import { z } from "zod";
import { NPC_MEMORY_FACT_MAX_LENGTH, NPC_MEMORY_MAX_FACTS, NPC_MEMORY_MAX_WORDS } from "../firestore/schemas";
import { POS_TAGS, TOKEN_LIMITS, TokenizedLineSchema } from "../language/tokens";
import type { HybridTask } from "./routing";

/**
 * Response schemas of the hybrid tasks (npc-runtime.md §3.1, §4, §5, §6.1, §7). Each task has:
 * - a JSON schema, passed both as `inCloudParams.generationConfig.responseSchema` and as
 *   `onDeviceParams.promptOptions.responseConstraint` (architecture §5.2). It uses only the
 *   OpenAPI subset both Gemini and Chrome's Prompt API accept (type, properties, required,
 *   items, enum, minimum/maximum, maxItems);
 * - a zod schema that every answer goes through before use (model output is untrusted). The zod
 *   schemas are lenient where a small model tends to overshoot (too many facts, a score of 1.2):
 *   they trim and clamp instead of failing, but reject the wrong shape.
 */

/** The JSON schema subset used for structured output (matches Firebase AI Logic `SchemaRequest`). */
// A type alias, not an interface, so it is assignable to the SDK's index-signature schema type.
export type AiJsonSchema = {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  properties?: Record<string, AiJsonSchema>;
  required?: string[];
  items?: AiJsonSchema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxItems?: number;
};

const str = (description?: string): AiJsonSchema => ({ type: "string", ...(description ? { description } : {}) });
const obj = (properties: Record<string, AiJsonSchema>, required: string[]): AiJsonSchema => ({ type: "object", properties, required });

const clampText = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const clamp01 = z.number().transform((n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0));
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/) : []);
const clampWords = (max: number) => (s: string) => words(s).slice(0, max).join(" ");

// §5.1 Tokenize + gloss: the M19 tokenized line.
export const GlossResponseSchema = TokenizedLineSchema;
export type GlossResponse = z.output<typeof GlossResponseSchema>;
export const GLOSS_JSON_SCHEMA: AiJsonSchema = obj(
  {
    tokens: {
      type: "array",
      maxItems: TOKEN_LIMITS.tokens,
      items: obj(
        { surface: str(), lemma: str(), reading: str(), gloss: str(), pos: { type: "string", enum: [...POS_TAGS] } },
        ["surface", "gloss"],
      ),
    },
    translation: str(),
  },
  ["tokens", "translation"],
);

// §5.2 Short translation.
export const TranslationResponseSchema = z.object({
  translation: z.string().trim().min(1).max(TOKEN_LIMITS.translation),
});
export type TranslationResponse = z.output<typeof TranslationResponseSchema>;
export const TRANSLATION_JSON_SCHEMA: AiJsonSchema = obj({ translation: str() }, ["translation"]);

// §4.1 Grammar feedback: {"ok":true} or {"ok":false,"better":"…","note":"…"}.
export const GRAMMAR_NOTE_MAX_WORDS = 12;
export const GrammarFeedbackSchema = z
  .object({
    ok: z.boolean(),
    better: z.string().trim().max(400).optional(),
    note: z.string().trim().max(200).transform(clampWords(GRAMMAR_NOTE_MAX_WORDS)).optional(),
  })
  .transform((v): { ok: true } | { ok: false; better: string; note?: string } =>
    // "Not ok" with no better version gives the player nothing to act on: treat it as ok.
    v.ok || !v.better ? { ok: true } : { ok: false, better: v.better, ...(v.note ? { note: v.note } : {}) },
  );
export type GrammarFeedback = z.output<typeof GrammarFeedbackSchema>;
export const GRAMMAR_JSON_SCHEMA: AiJsonSchema = obj({ ok: { type: "boolean" }, better: str(), note: str() }, ["ok"]);

// §6.1 Moderation.
export const MODERATION_CATEGORIES = ["harassment", "hate", "sexual", "selfharm", "threat", "personal_data", "spam"] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];
export const ModerationResponseSchema = z
  .object({
    ok: z.boolean(),
    category: z.enum(MODERATION_CATEGORIES).optional().catch(undefined),
  })
  .transform((v): { ok: true } | { ok: false; category?: ModerationCategory } =>
    v.ok ? { ok: true } : { ok: false, ...(v.category ? { category: v.category } : {}) },
  );
export type ModerationResponse = z.output<typeof ModerationResponseSchema>;
export const MODERATION_JSON_SCHEMA: AiJsonSchema = obj(
  { ok: { type: "boolean" }, category: { type: "string", enum: [...MODERATION_CATEGORIES] } },
  ["ok"],
);

// §7 Conversation compaction. The server caps again (architecture §6.1); these keep it bounded.
export const COMPACTION_MAX_STRUGGLES = 8;
export const CompactionResponseSchema = z.object({
  summary: z.string().max(NPC_MEMORY_MAX_WORDS * 16).transform(clampWords(NPC_MEMORY_MAX_WORDS)),
  facts: z
    .array(clampText(NPC_MEMORY_FACT_MAX_LENGTH))
    .max(NPC_MEMORY_MAX_FACTS * 3)
    .transform((f) => f.filter(Boolean).slice(0, NPC_MEMORY_MAX_FACTS)),
  signals: z.object({
    comprehension: clamp01,
    expression: clamp01,
    usedNativeLanguage: z.boolean(),
    struggles: z
      .array(clampText(40))
      .max(COMPACTION_MAX_STRUGGLES * 3)
      .default([])
      .transform((s) => s.filter(Boolean).slice(0, COMPACTION_MAX_STRUGGLES)),
  }),
});
export type CompactionResponse = z.output<typeof CompactionResponseSchema>;
export const COMPACTION_JSON_SCHEMA: AiJsonSchema = obj(
  {
    summary: str(),
    facts: { type: "array", maxItems: NPC_MEMORY_MAX_FACTS, items: str() },
    signals: obj(
      {
        comprehension: { type: "number", minimum: 0, maximum: 1 },
        expression: { type: "number", minimum: 0, maximum: 1 },
        usedNativeLanguage: { type: "boolean" },
        struggles: { type: "array", maxItems: COMPACTION_MAX_STRUGGLES, items: str() },
      },
      ["comprehension", "expression", "usedNativeLanguage", "struggles"],
    ),
  },
  ["summary", "facts", "signals"],
);

// §3.1 Opener personalisation: under 14 words is asked; a little over is tolerated.
export const OPENER_MAX_WORDS = 14;
export const OpenerResponseSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .refine((s) => words(s).length <= OPENER_MAX_WORDS * 2, { message: "opener too long" }),
});
export type OpenerResponse = z.output<typeof OpenerResponseSchema>;
export const OPENER_JSON_SCHEMA: AiJsonSchema = obj({ text: str() }, ["text"]);

// §4.2 Language detection: an ISO 639-1 code (639-3 tolerated).
export const LanguageDetectionSchema = z.object({
  lang: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2,3}$/),
});
export type LanguageDetection = z.output<typeof LanguageDetectionSchema>;
export const LANGUAGE_DETECTION_JSON_SCHEMA: AiJsonSchema = obj({ lang: str("ISO 639-1 code") }, ["lang"]);

// Build plan M25 world labels: entries with an unknown key shape or an empty word are dropped.
export const WORLD_LABEL_WORD_MAX = 200;
const WorldLabelSchema = z.object({
  key: z.string(),
  word: z.string(),
  reading: z.string().optional().nullable(),
});
export const WorldLabelsResponseSchema = z.object({
  labels: z
    .array(WorldLabelSchema)
    .max(64)
    .transform((list) =>
      list.flatMap((l) => {
        const key = l.key.trim();
        const word = l.word.replace(/\s+/g, " ").trim().slice(0, WORLD_LABEL_WORD_MAX);
        const reading = l.reading?.replace(/\s+/g, " ").trim().slice(0, 400);
        if (!/^[a-z0-9_.-]{1,64}$/.test(key) || !word) return [];
        return [reading && reading !== word ? { key, word, reading } : { key, word }];
      }),
    ),
});
export type WorldLabelsResponse = z.output<typeof WorldLabelsResponseSchema>;
export const WORLD_LABELS_JSON_SCHEMA: AiJsonSchema = obj(
  { labels: { type: "array", maxItems: 64, items: obj({ key: str(), word: str(), reading: str() }, ["key", "word"]) } },
  ["labels"],
);

/** Each task's JSON schema and zod schema. */
export const TASK_SCHEMAS = {
  gloss: { json: GLOSS_JSON_SCHEMA, zod: GlossResponseSchema },
  glossLong: { json: GLOSS_JSON_SCHEMA, zod: GlossResponseSchema },
  translateShort: { json: TRANSLATION_JSON_SCHEMA, zod: TranslationResponseSchema },
  translateLong: { json: TRANSLATION_JSON_SCHEMA, zod: TranslationResponseSchema },
  grammarFeedback: { json: GRAMMAR_JSON_SCHEMA, zod: GrammarFeedbackSchema },
  moderateOutgoing: { json: MODERATION_JSON_SCHEMA, zod: ModerationResponseSchema },
  moderateIncoming: { json: MODERATION_JSON_SCHEMA, zod: ModerationResponseSchema },
  compactConversation: { json: COMPACTION_JSON_SCHEMA, zod: CompactionResponseSchema },
  personaliseOpener: { json: OPENER_JSON_SCHEMA, zod: OpenerResponseSchema },
  detectLanguage: { json: LANGUAGE_DETECTION_JSON_SCHEMA, zod: LanguageDetectionSchema },
  worldLabels: { json: WORLD_LABELS_JSON_SCHEMA, zod: WorldLabelsResponseSchema },
} as const satisfies Record<HybridTask, { json: AiJsonSchema; zod: z.ZodType }>;

export type TaskOutput<T extends HybridTask> = z.output<(typeof TASK_SCHEMAS)[T]["zod"]>;

/**
 * Parses a model answer: JSON text (a ```json fence, which small models sometimes add, is
 * tolerated) through the task's zod schema. Throws on anything else.
 */
export function parseTaskAnswer<T extends HybridTask>(task: T, text: string): TaskOutput<T> {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const json: unknown = JSON.parse(unfenced);
  return TASK_SCHEMAS[task].zod.parse(json) as TaskOutput<T>;
}
