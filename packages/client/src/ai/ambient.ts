import { type AmbientBark, type AmbientBarksResponse, CachedLineSchema, exchangeSeedMaterial, soloBarkSeedMaterial } from "@hellovalley/shared";
import type { BarkLine } from "./barks";
import type { TaskResult } from "./hybrid";

/**
 * The words of an ambient bark (build plan M31, npc-runtime.md §9.1), looked up like every piece
 * of shared content (CLAUDE.md, architecture §6.3):
 *
 * 1. the seeded lines in `cache/lines/{sha256(material)}`, written only by the admin seeding tool
 *    (`npm run seed:ambient`), with their translation into the player's language;
 * 2. on a miss, the whole set generated once for this player (hybrid `ambientBarks`, cloud first),
 *    which the hybrid module keeps in the player's memory + IndexedDB cache, never in Firestore.
 *
 * The server picks the line index, so every player near the villagers sees the same moment, each
 * in their own target language. Without either (offline, no AI backend) the villagers stay quiet.
 */

export interface AmbientBarkDeps {
  /** The seeded `cache/lines` document for a key material, or null. Never throws. */
  seeded?: (material: string) => Promise<unknown>;
  generate: (input: { bark: AmbientBark; targetLang: string; nativeLang: string }) => Promise<TaskResult<AmbientBarksResponse>>;
}

export interface AmbientBarks {
  /** One line for a solo bark, two (in speaking order) for an exchange; null when there are none. */
  get(input: { bark: AmbientBark; targetLang: string; nativeLang: string }): Promise<BarkLine[] | null>;
}

export function createAmbientBarks(deps: AmbientBarkDeps): AmbientBarks {
  const seededLine = async (material: string, nativeLang: string): Promise<BarkLine | null> => {
    if (!deps.seeded) return null;
    const raw = await deps.seeded(material).catch(() => null);
    const parsed = CachedLineSchema.safeParse(raw);
    if (!raw || !parsed.success) return null;
    const line = parsed.data;
    return { text: line.text, ...(line.reading ? { reading: line.reading } : {}), translation: line.translation?.[nativeLang] ?? "" };
  };
  return {
    async get({ bark, targetLang, nativeLang }) {
      if (bark.kind === "solo") {
        const seeded = await seededLine(soloBarkSeedMaterial(bark.npcId, bark.activity, targetLang, bark.index), nativeLang);
        if (seeded) return [seeded];
      } else {
        const [first, second] = await Promise.all([0, 1].map((k) => seededLine(exchangeSeedMaterial(bark.a, bark.b, targetLang, bark.index, k as 0 | 1), nativeLang)));
        if (first && second) return [first, second];
      }
      const generated = await deps.generate({ bark, targetLang, nativeLang }).catch(() => null);
      if (!generated?.ok) return null;
      const { barks, exchanges } = generated.value;
      if (bark.kind === "solo") {
        const line = barks[bark.index % Math.max(1, barks.length)];
        return line ? [line] : null;
      }
      const exchange = exchanges[bark.index % Math.max(1, exchanges.length)];
      return exchange ? [exchange.first, exchange.second] : null;
    },
  };
}
