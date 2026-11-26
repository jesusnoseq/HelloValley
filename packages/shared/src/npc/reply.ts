import { z } from "zod";
import { TOKEN_LIMITS, TokenSchema } from "../language/tokens";
import { NpcActionListSchema } from "./actions";

/**
 * The NPC turn answer (docs/prompts/npc-runtime.md §1.3), as the `npc-turn` server prompt template
 * returns it to the client. Model output is untrusted: every answer goes through
 * `NpcTurnReplySchema` before anything is shown, and the actions in it are only a proposal that
 * the game server validates again (architecture §6.1).
 *
 * The schema is lenient where a model tends to overshoot (a fourth line, a long note, an unknown
 * emotion or action) and strict on shape. Template output schemas make every optional field
 * nullable (Firebase AI Logic Picoschema), so `null` is treated as "absent" (`stripNulls`).
 */

export const NPC_EMOTIONS = ["neutral", "happy", "excited", "sad", "annoyed", "whisper", "tired", "proud", "nostalgic"] as const;
export type NpcEmotion = (typeof NPC_EMOTIONS)[number];

/**
 * npc-runtime.md §1: 1–3 lines per turn, at most 3 suggested replies, plus the coffee buff's one
 * extra hint (build plan M29), so 4 are kept.
 */
export const NPC_TURN_MAX_LINES = 3;
export const NPC_TURN_MAX_SUGGESTIONS = 4;
/** npc-runtime.md §1.3: the correction note is at most 15 words. */
export const CORRECTION_NOTE_MAX_WORDS = 15;
/** Inline-tag transcript for TTS (M22), at most this long. */
export const TTS_TAGS_MAX_LENGTH = 800;

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/) : []);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const emptyToUndefined = <T extends Record<string, unknown>>(v: T, keys: readonly (keyof T)[]): T => {
  const out = { ...v };
  for (const k of keys) if (out[k] === "") delete out[k];
  return out;
};

export const NpcLineSchema = z
  .object({
    text: z.string().trim().min(1).max(TOKEN_LIMITS.text),
    reading: optionalText(TOKEN_LIMITS.translation),
    translation: z.string().trim().max(TOKEN_LIMITS.translation),
    emotion: z.enum(NPC_EMOTIONS).optional().catch(undefined),
    ttsTags: optionalText(TTS_TAGS_MAX_LENGTH),
    tokens: z.array(TokenSchema).min(1).max(TOKEN_LIMITS.tokens),
  })
  .transform((l) => emptyToUndefined(l, ["reading", "ttsTags"]));
export type NpcLine = z.output<typeof NpcLineSchema>;
export type NpcLineInput = z.input<typeof NpcLineSchema>;

export const SuggestedReplySchema = z
  .object({
    text: z.string().trim().min(1).max(TOKEN_LIMITS.text),
    reading: optionalText(TOKEN_LIMITS.translation),
    translation: z.string().trim().max(TOKEN_LIMITS.translation).default(""),
  })
  .transform((s) => emptyToUndefined(s, ["reading"]));
export type SuggestedReply = z.output<typeof SuggestedReplySchema>;

export const CorrectionSchema = z.object({
  original: optionalText(TOKEN_LIMITS.text),
  better: optionalText(TOKEN_LIMITS.text),
  note: z
    .string()
    .trim()
    .max(400)
    .transform((s) => words(s).slice(0, CORRECTION_NOTE_MAX_WORDS).join(" "))
    .optional(),
});
export type Correction = z.output<typeof CorrectionSchema>;

export const TeachSchema = z.object({
  phrase: z.string().trim().min(1).max(TOKEN_LIMITS.text),
  reading: optionalText(TOKEN_LIMITS.translation),
  meaning: optionalText(TOKEN_LIMITS.translation),
});
export type Teach = z.output<typeof TeachSchema>;

export const NpcTurnReplySchema = z
  .object({
    // A fourth line or suggestion is cut, not fatal; a runaway list is.
    lines: z.array(NpcLineSchema).min(1).max(NPC_TURN_MAX_LINES * 2),
    suggestedReplies: z.array(SuggestedReplySchema).max(NPC_TURN_MAX_SUGGESTIONS * 3).default([]),
    correction: CorrectionSchema.optional().catch(undefined),
    teach: TeachSchema.optional().catch(undefined),
    actions: NpcActionListSchema.default([]),
  })
  .transform((r) => {
    const correction = r.correction && r.correction.better ? r.correction : undefined;
    return {
      lines: r.lines.slice(0, NPC_TURN_MAX_LINES),
      suggestedReplies: r.suggestedReplies.slice(0, NPC_TURN_MAX_SUGGESTIONS),
      ...(correction ? { correction } : {}),
      ...(r.teach ? { teach: r.teach } : {}),
      actions: r.actions,
    };
  });
export type NpcTurnReply = z.output<typeof NpcTurnReplySchema>;
export type NpcTurnReplyInput = z.input<typeof NpcTurnReplySchema>;

/** Removes `null` values (Picoschema optional fields are nullable) from objects and arrays, deeply. */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== null).map(stripNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = stripNulls(v);
    return out;
  }
  return value;
}

/**
 * The local repair step before any retry: a ```json fence, text before the first `{` or after the
 * last `}` (a model that adds a sentence), and nulls are tolerated. Throws when no JSON object is left.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object in the answer");
  return stripNulls(JSON.parse(trimmed.slice(start, end + 1)));
}

export type ReplyParseResult = { ok: true; reply: NpcTurnReply } | { ok: false; error: string };

/** Parses a model answer (JSON text) into a validated NPC turn. Never throws. */
export function parseNpcTurnReply(text: string): ReplyParseResult {
  let json: unknown;
  try {
    json = extractJsonObject(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }
  const parsed = NpcTurnReplySchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: shortZodError(parsed.error) };
  return { ok: true, reply: parsed.data };
}

/** The first few issues, one line (for the repair retry message and logs). */
export function shortZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * The line texts that have fully arrived in a partial (streaming) JSON answer, so the bubble can
 * show text before the whole turn is in (build plan M21 "stream text as soon as it arrives").
 * It scans for completed `"text": "…"` values that belong to `lines` (before `suggestedReplies`).
 */
export function streamedLineTexts(partial: string): string[] {
  const linesAt = partial.indexOf('"lines"');
  if (linesAt < 0) return [];
  const after = partial.slice(linesAt);
  const stop = after.search(/"(suggestedReplies|correction|teach|actions)"\s*:/);
  const region = stop < 0 ? after : after.slice(0, stop);
  const texts: string[] = [];
  // Only "text" keys directly in a line object (tokens use "surface"), with a closed string value.
  const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(region); m; m = re.exec(region)) {
    try {
      const value = JSON.parse(`"${m[1]}"`) as string;
      if (value.trim()) texts.push(value.trim());
    } catch {
      // A half-escaped value: wait for more text.
    }
  }
  return texts.slice(0, NPC_TURN_MAX_LINES);
}
