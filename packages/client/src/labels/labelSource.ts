import {
  type CachedLabels,
  CachedLabelsSchema,
  FirestorePaths,
  LABEL_KEYS,
  labelEnglish,
  WORLD_LABELS_BATCH,
  type WorldLabelsPromptInput,
  type WorldLabelsResponse,
} from "@hellovalley/shared";
import type { TaskResult } from "../ai/hybrid";

/**
 * World labels for one target language (build plan M25, GDD §6.5, architecture §5.2 / §6.3):
 *
 * 1. the session's memory map;
 * 2. the seeded `cache/labels/{lang}` document, written only by the admin seeding tool
 *    (`tools/seed/seed-labels.ts`);
 * 3. keys the seeded document lacks are generated for this player only, in batches, with the
 *    hybrid `worldLabels` task (cloud first). The hybrid module caches each batch in the player's
 *    memory LRU + IndexedDB, so a returning player does not pay again; nothing goes to Firestore.
 *
 * Batches that fail stay missing (the label shows its English word with no audio) and are tried
 * again on the next load after LABEL_RETRY_MS.
 */

export interface LabelText {
  word: string;
  reading?: string;
  /** Seeded clip hash (the seeding tool voices labels), when there is one. */
  audioHash?: string;
}
export type LabelMap = Readonly<Record<string, LabelText>>;

export interface LabelDeps {
  /** The seeded document for a language, or null (a miss, offline, no sign-in). Never throws. */
  seeded(lang: string): Promise<CachedLabels | null>;
  generate(input: WorldLabelsPromptInput): Promise<TaskResult<WorldLabelsResponse>>;
  now?: () => number;
}

export interface LabelLoad {
  labels: LabelMap;
  /** Every registry key has a label. */
  complete: boolean;
}

export interface LabelSource {
  load(lang: string): Promise<LabelLoad>;
}

/** Wait before generating failed batches again (my number). */
export const LABEL_RETRY_MS = 60_000;

export function createLabelSource(deps: LabelDeps): LabelSource {
  const now = deps.now ?? Date.now;
  const done = new Map<string, LabelLoad>();
  const partial = new Map<string, { labels: Record<string, LabelText>; at: number }>();
  const inFlight = new Map<string, Promise<LabelLoad>>();

  async function fill(lang: string): Promise<LabelLoad> {
    const prev = partial.get(lang);
    const labels: Record<string, LabelText> = { ...(prev?.labels ?? {}) };
    if (!prev) {
      const seeded = await deps.seeded(lang).catch(() => null);
      for (const [key, value] of Object.entries(seeded ?? {})) labels[key] = value;
    }
    const missing = LABEL_KEYS.filter((k) => !labels[k]);
    for (let i = 0; i < missing.length; i += WORLD_LABELS_BATCH) {
      const batch = missing.slice(i, i + WORLD_LABELS_BATCH);
      const result = await deps.generate({ targetLang: lang, items: batch.map((key) => ({ key, english: labelEnglish(key) })) }).catch(() => null);
      if (!result?.ok) continue;
      const wanted = new Set(batch);
      for (const l of result.value.labels) if (wanted.has(l.key)) labels[l.key] = l.reading ? { word: l.word, reading: l.reading } : { word: l.word };
    }
    const complete = LABEL_KEYS.every((k) => labels[k]);
    const load = { labels, complete };
    if (complete) {
      done.set(lang, load);
      partial.delete(lang);
    } else partial.set(lang, { labels, at: now() });
    return load;
  }

  return {
    load(lang) {
      const hit = done.get(lang);
      if (hit) return Promise.resolve(hit);
      const p = partial.get(lang);
      if (p && now() - p.at < LABEL_RETRY_MS) return Promise.resolve({ labels: p.labels, complete: false });
      let pending = inFlight.get(lang);
      if (!pending) {
        pending = fill(lang).finally(() => inFlight.delete(lang));
        inFlight.set(lang, pending);
      }
      return pending;
    },
  };
}

/** Minimal Firestore surface the seeded reader needs (keeps this file testable without the SDK). */
export type ReadDoc = (path: string) => Promise<{ exists: boolean; data: unknown } | null>;

/** `cache/labels/{lang}`, validated; anything malformed is a miss. */
export function seededLabelsReader(read: ReadDoc): LabelDeps["seeded"] {
  return async (lang) => {
    try {
      const snap = await read(FirestorePaths.cacheEntry("labels", lang));
      if (!snap?.exists) return null;
      const parsed = CachedLabelsSchema.safeParse(snap.data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };
}
