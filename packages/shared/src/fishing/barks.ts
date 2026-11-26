import { contentKeyMaterial } from "../ai/cacheKey";
import type { FishId } from "../data/fish";

/**
 * The Elder's comments on a catch (build plan M27, GDD §5.2, npc-runtime.md §9.5). Shared content:
 * the admin seeding tool writes one line per fish and target language into `cache/lines/{hash}`
 * (with translations by native language), keyed by `elderBarkSeedMaterial`; on a miss the client
 * generates three lines for that player (hybrid task `elderBark`) and keeps them in its own cache
 * under `elderBarkPlayerMaterial` (the native language is part of it, for the translation).
 */

/** The Elder's barks are written at A2 (npc-runtime.md §9.1). */
export const ELDER_BARK_LEVEL = "A2";

/** Key material of the seeded line (`cache/lines/{sha256(material)}`). */
export function elderBarkSeedMaterial(fishId: FishId, targetLang: string): string {
  return contentKeyMaterial({ kind: "elderBark", npcId: "elder", lang: targetLang, level: ELDER_BARK_LEVEL, text: fishId });
}

/** Key material of a player's generated lines (their content cache). */
export function elderBarkPlayerMaterial(fishId: FishId, targetLang: string, nativeLang: string): string {
  return contentKeyMaterial({ kind: "elderBark", npcId: "elder", lang: `${targetLang}>${nativeLang}`, level: ELDER_BARK_LEVEL, text: fishId });
}
