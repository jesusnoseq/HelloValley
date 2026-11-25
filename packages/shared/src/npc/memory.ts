import { z } from "zod";
import { sanitizePlayerText } from "../ai/prompts";
import { CompactionResponseSchema } from "../ai/schemas";
import { NPC_MEMORY_FACT_MAX_LENGTH, NPC_MEMORY_MAX_FACTS, NPC_MEMORY_MAX_WORDS } from "../firestore/schemas";

/**
 * Per-player NPC memory (GDD §8.2, build plan M24, npc-runtime.md §7). After a conversation the
 * client compacts the transcript (hybrid AI, on-device first with the AI Logic cloud fallback) and
 * sends the result to the game server as `npc:memory`. It is model output relayed by the client,
 * so it is untrusted: the server sanitises and caps it here (architecture §6.1: 120 words,
 * 10 facts) before it stores it and feeds it back into the NPC's next prompt. A forged memory only
 * ever reaches the forger's own NPC prompts, as quoted data.
 */

export interface NpcMemoryText {
  summary: string;
  facts: string[];
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** One line of plain text: no control characters, no quote tags, single spaces. */
export function sanitizeMemoryText(text: string): string {
  return sanitizePlayerText(text.replace(CONTROL, " "))
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const capWords = (text: string, max: number) => text.split(" ").filter(Boolean).slice(0, max).join(" ");
const factKey = (fact: string) => fact.toLocaleLowerCase().replace(/[\s.!?。！？]+$/u, "");

/**
 * Merges a compaction into the stored memory. The summary is the model's merged summary (the
 * prompt includes the previous one); an empty one keeps the previous. Facts: the new ones first,
 * then the previous ones not repeated, at most 10 in all.
 */
export function mergeNpcMemory(previous: NpcMemoryText | null, next: NpcMemoryText): NpcMemoryText {
  const summary = capWords(sanitizeMemoryText(next.summary), NPC_MEMORY_MAX_WORDS) || previous?.summary || "";
  const facts: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...next.facts, ...(previous?.facts ?? [])]) {
    const fact = sanitizeMemoryText(raw).slice(0, NPC_MEMORY_FACT_MAX_LENGTH).trim();
    const key = factKey(fact);
    if (!fact || seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
    if (facts.length >= NPC_MEMORY_MAX_FACTS) break;
  }
  return { summary, facts };
}

// ---------------------------------------------------------------------------------------------
// Level telemetry (GDD §6.4: suggested replies used vs free input, hover-translation rate,
// grammar corrections). Counted by the client's conversation panel; untrusted, so bounded here.

/** Most of any count accepted from one conversation (a conversation has at most 30 turns). */
export const TELEMETRY_MAX_COUNT = 200;

const count = z
  .number()
  .finite()
  .transform((n) => Math.min(TELEMETRY_MAX_COUNT, Math.max(0, Math.round(n))));

export const ConversationTelemetrySchema = z.object({
  /** Player lines sent as a suggested reply. */
  suggested: count,
  /** Player lines typed or spoken. */
  free: count,
  /** NPC lines shown. */
  npcLines: count,
  /** NPC lines whose translation the player opened (hover or 🌐). */
  translationsShown: count,
  /** Corrections: the NPC's `correction` and the pre-send grammar chip. */
  corrections: count,
});
export type ConversationTelemetry = z.output<typeof ConversationTelemetrySchema>;
export type ConversationTelemetryInput = z.input<typeof ConversationTelemetrySchema>;

export const emptyTelemetry = (): ConversationTelemetry => ({ suggested: 0, free: 0, npcLines: 0, translationsShown: 0, corrections: 0 });

/** The compaction answer as the client relays it (the same lenient schema the client validated it with). */
export const NpcMemoryPayloadSchema = CompactionResponseSchema;
