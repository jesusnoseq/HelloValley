import { CachedLineSchema, elderBarkSeedMaterial, type ElderBarkResponse, type FishId, getFish } from "@hellovalley/shared";
import type { TaskResult } from "./hybrid";

/**
 * The Elder's comment on a catch (build plan M27, GDD §5.2 "the Elder comments on your catch with
 * proverbs"), looked up like every piece of shared content (CLAUDE.md, architecture §6.3):
 *
 * 1. the seeded line in `cache/lines/{sha256(elderBarkSeedMaterial)}`, written only by the admin
 *    seeding tool (`npm run seed:barks`), with its translation into the player's language;
 * 2. on a miss, three lines generated for this player (hybrid `elderBark`, cloud first), which the
 *    hybrid module keeps in the player's memory + IndexedDB cache, never in Firestore.
 *
 * One line is picked at random. Without either (offline, no AI backend) the Elder stays quiet.
 */

export interface BarkLine {
  text: string;
  reading?: string;
  /** Into the player's native language ("" when the seeded line has none for it). */
  translation: string;
}

export interface ElderBarkDeps {
  /** The seeded `cache/lines` document for a key material, or null. Never throws. */
  seeded?: (material: string) => Promise<unknown>;
  generate: (input: { targetLang: string; nativeLang: string; fishEnglish: string; rarity: string; fishId: FishId }) => Promise<TaskResult<ElderBarkResponse>>;
  random?: () => number;
}

export interface ElderBarks {
  get(input: { fishId: FishId; targetLang: string; nativeLang: string }): Promise<BarkLine | null>;
}

export function createElderBarks(deps: ElderBarkDeps): ElderBarks {
  const random = deps.random ?? Math.random;
  return {
    async get({ fishId, targetLang, nativeLang }) {
      const fish = getFish(fishId);
      if (!fish) return null;
      if (deps.seeded) {
        const raw = await deps.seeded(elderBarkSeedMaterial(fishId, targetLang)).catch(() => null);
        const parsed = CachedLineSchema.safeParse(raw);
        if (raw && parsed.success) {
          const line = parsed.data;
          return { text: line.text, ...(line.reading ? { reading: line.reading } : {}), translation: line.translation?.[nativeLang] ?? "" };
        }
      }
      const generated = await deps.generate({ targetLang, nativeLang, fishEnglish: fish.englishName, rarity: fish.rarity, fishId }).catch(() => null);
      if (!generated?.ok) return null;
      const lines = generated.value.lines;
      return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))] ?? null;
    },
  };
}
