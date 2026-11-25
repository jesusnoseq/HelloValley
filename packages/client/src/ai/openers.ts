import {
  buildOpenerVariables,
  fillOpenerName,
  type GlossResponse,
  type NpcContextMessage,
  type NpcLine,
  openerBandsFor,
  openerKeyMaterial,
  type OpenerSet,
  OpenerSetSchema,
  parseOpenerSet,
  pickOpener,
  PROMPT_TEMPLATE_IDS,
} from "@hellovalley/shared";
import type { ContentCache } from "./cache";
import type { TaskResult } from "./hybrid";
import type { TemplateGeneratePort } from "./templates";

/**
 * Conversation openers (build plan M21, GDD §8.1 step 2, npc-runtime.md §3). Four openers per
 * NPC × target language × level band × time band × friendship band (× native language, for the
 * translations), looked up in this order:
 *
 * 1. the player's own cache (memory LRU + IndexedDB, `sha256(kind, npcId, lang, level, text)`);
 * 2. seeded shared openers (`cache/lines`, written only by the admin seeding tool; architecture
 *    §6.3). TODO(seeding tool, not in the build plan yet): the reader is injected and absent by default;
 * 3. on a miss, the set is generated once with the `npc-opener` template and kept in the
 *    player's own cache (never in Firestore, so one player cannot poison another's openers).
 *
 * One opener is picked at random, the player's name goes in, and when there is a memory the
 * on-device model may personalise it (ONLY_ON_DEVICE; the cached opener is used unchanged when
 * that, or tokenizing the new text, fails).
 */

export interface OpenerDeps {
  generate: TemplateGeneratePort;
  cloudEnabled: boolean;
  cache?: ContentCache;
  /** Seeded `cache/lines` reader (by key material), when one exists. */
  seeded?: (material: string) => Promise<unknown>;
  /** On-device personalisation (hybrid `personaliseOpener`). */
  personalise?: (input: { targetLang: string; level: string; cachedOpener: string; memorySummary: string }) => Promise<TaskResult<{ text: string }>>;
  /** Tokenize + gloss a personalised opener (hybrid `gloss`). */
  gloss?: (input: { text: string; sourceLang: string; nativeLang: string; level: string }) => Promise<TaskResult<GlossResponse>>;
  random?: () => number;
  templateId?: string;
  warn?: (message: string, error: unknown) => void;
}

export interface OpenerResult {
  line: NpcLine;
  source: "cache" | "seeded" | "generated";
  personalised: boolean;
}

export interface Openers {
  /** The opener for a conversation, or null when none could be found or made. */
  get(context: NpcContextMessage, playerName: string): Promise<OpenerResult | null>;
}

export function createOpeners(deps: OpenerDeps): Openers {
  const warn = deps.warn ?? ((message, error) => console.warn(message, error));
  const random = deps.random ?? Math.random;
  const inFlight = new Map<string, Promise<{ set: OpenerSet; source: OpenerResult["source"] } | null>>();

  async function lookup(material: string, variables: ReturnType<typeof buildOpenerVariables>) {
    const cached = await deps.cache?.get(material, true).catch(() => undefined);
    const fromCache = OpenerSetSchema.safeParse(cached);
    if (cached !== undefined && fromCache.success) return { set: fromCache.data, source: "cache" as const };
    if (deps.seeded) {
      const seeded = await deps.seeded(material).catch(() => null);
      const parsed = OpenerSetSchema.safeParse(seeded);
      if (seeded && parsed.success) {
        await deps.cache?.set(material, parsed.data, false).catch(() => undefined);
        return { set: parsed.data, source: "seeded" as const };
      }
    }
    if (!deps.cloudEnabled) return null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await deps.generate({ templateId: deps.templateId ?? PROMPT_TEMPLATE_IDS.npcOpener, variables });
        const parsed = parseOpenerSet(text);
        if (parsed.ok) {
          await deps.cache?.set(material, parsed.value, true).catch(() => undefined);
          return { set: parsed.value, source: "generated" as const };
        }
        if (attempt === 2) warn("ai: opener set invalid", parsed.error);
      } catch (error) {
        if (attempt === 2) warn("ai: opener generation failed", error);
      }
    }
    return null;
  }

  return {
    async get(context, playerName) {
      const bands = openerBandsFor({
        npcId: context.npcId,
        targetLang: context.lang,
        nativeLang: context.nativeLang,
        effectiveLevel: context.effectiveLevel,
        timeOfDay: context.world.timeOfDay,
        hearts: context.hearts,
      });
      const material = openerKeyMaterial(bands);
      let pending = inFlight.get(material);
      if (!pending) {
        pending = lookup(material, buildOpenerVariables(bands)).finally(() => inFlight.delete(material));
        inFlight.set(material, pending);
      }
      const found = await pending;
      if (!found) return null;
      const line = fillOpenerName(pickOpener(found.set, random()), playerName);
      const memory = context.memory?.summary.trim();
      if (!memory || !deps.personalise) return { line, source: found.source, personalised: false };
      const personal = await deps.personalise({ targetLang: context.lang, level: context.effectiveLevel, cachedOpener: line.text, memorySummary: memory }).catch(() => null);
      if (!personal?.ok || personal.value.text.trim() === line.text.trim() || !deps.gloss) return { line, source: found.source, personalised: false };
      const glossed = await deps
        .gloss({ text: personal.value.text, sourceLang: context.lang, nativeLang: context.nativeLang, level: context.effectiveLevel })
        .catch(() => null);
      if (!glossed?.ok) return { line, source: found.source, personalised: false };
      const text = personal.value.text.trim();
      return {
        line: { text, translation: glossed.value.translation, tokens: glossed.value.tokens, ...(glossed.value.reading ? { reading: glossed.value.reading } : {}), ...(line.emotion ? { emotion: line.emotion } : {}) },
        source: found.source,
        personalised: true,
      };
    },
  };
}
