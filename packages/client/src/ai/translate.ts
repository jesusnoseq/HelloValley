/**
 * Translation for player-to-player chat (GDD §6.6, build plan M18), part of the client's AI
 * module: every model call runs in the client through Firebase AI Logic (architecture §5). The
 * game server never translates. Translations are cached per message id (and target language).
 *
 * TODO(M20): the real translator in `ai/hybrid.ts`: the `translateShort` task (on-device first,
 * `PREFER_ON_DEVICE`) for lines under SHORT_TRANSLATION_MAX_WORDS words and `PREFER_IN_CLOUD`
 * for longer ones (architecture §5.2), one single-turn prompt with a small JSON answer, the
 * player text quoted as `<player_text>` data, zod-validated. Until then `stubTranslator` answers
 * "unavailable" and the chat shows the original text with a chip.
 */

export interface TranslateRequest {
  /** The chat message id (the cache key, with `to`). */
  messageId: string;
  /** The text as written (player text: quoted data in the prompt, never instructions). */
  text: string;
  /** The language it is written in. */
  from: string;
  /** The language to translate into. */
  to: string;
}

export type TranslateResult =
  | { ok: true; text: string; via: "on-device" | "cloud" }
  | { ok: false; reason: "unavailable" | "failed" };

export interface Translator {
  translate(request: TranslateRequest): Promise<TranslateResult>;
}

/** Architecture §5.2: lines under this many words translate on-device first, longer ones in the cloud. */
export const SHORT_TRANSLATION_MAX_WORDS = 25;

/** The stand-in until M20: no model yet, so every translation is unavailable. */
export const stubTranslator: Translator = {
  translate: () => Promise.resolve({ ok: false, reason: "unavailable" }),
};

/** Translations kept per session (chat lines are short-lived; my number). */
export const TRANSLATION_CACHE_MAX = 500;

export interface CachedTranslator extends Translator {
  /** Cached (or in-flight) translations. */
  readonly size: number;
}

/**
 * Wraps a translator with a cache per message id and target language. Concurrent requests for
 * the same pair share one call; a failed or unavailable answer is not kept, so a later request
 * tries again (the on-device model may have finished downloading). Oldest entries go first.
 * TODO(M20): also keep translations in the per-player IndexedDB cache if chat history outlives
 * the session.
 */
export function createCachedTranslator(inner: Translator, maxEntries: number = TRANSLATION_CACHE_MAX): CachedTranslator {
  const cache = new Map<string, Promise<TranslateResult>>();
  return {
    get size() {
      return cache.size;
    },
    translate(request) {
      const key = `${request.messageId}\u0000${request.to.toLowerCase()}`;
      const hit = cache.get(key);
      if (hit) {
        // Refresh its place in the eviction order.
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const pending = inner
        .translate(request)
        .catch((): TranslateResult => ({ ok: false, reason: "failed" }))
        .then((result) => {
          if (!result.ok && cache.get(key) === pending) cache.delete(key);
          return result;
        });
      cache.set(key, pending);
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
      return pending;
    },
  };
}
