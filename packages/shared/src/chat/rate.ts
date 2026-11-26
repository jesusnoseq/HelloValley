/**
 * A token bucket for per-player message rate limits (architecture §6.4: the server always rate
 * limits chat). Pure: the caller passes the clock.
 */
export interface TokenBucket {
  tokens: number;
  /** Clock (ms) of the last refill. */
  at: number;
}

export interface RateLimit {
  /** Most messages in a burst. */
  burst: number;
  /** Sustained messages per second. */
  perSecond: number;
}

/**
 * Chat: bursts of 5 lines, then one every 1.5 s (my numbers). On top of it the TownRoom has one
 * bucket for every message of a client, and repeat offenders get shard-wide mutes (build plan M36,
 * safety/strikes.ts).
 */
export const CHAT_RATE: RateLimit = { burst: 5, perSecond: 1 / 1.5 };

export function createTokenBucket(limit: RateLimit, now: number): TokenBucket {
  return { tokens: limit.burst, at: now };
}

/** Takes one token if there is one (refilling for the time since the last call). */
export function takeToken(bucket: TokenBucket, limit: RateLimit, now: number): boolean {
  const elapsed = Math.max(0, now - bucket.at) / 1000;
  bucket.tokens = Math.min(limit.burst, bucket.tokens + elapsed * limit.perSecond);
  bucket.at = Math.max(bucket.at, now);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
