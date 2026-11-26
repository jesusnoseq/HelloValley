import { type BlocklistCategory, moderateNameText } from "@hellovalley/shared";

export type NameVerdict = { ok: true } | { ok: false; reason: "blocked"; category?: BlocklistCategory };

/**
 * Display-name moderation (GDD §3.3, §9.3; architecture §6.4: the server blocklist always runs;
 * build plan M36). Called by `POST /api/onboarding` after the name passed `PlayerNameSchema`: the
 * shared normalised blocklist (names also match inside, `xXfuckXx`), reserved staff names and
 * contact details (`moderateNameText`). Names are set once at onboarding; the game has no rename
 * (a future one must go through this same check).
 */
export async function moderateName(name: string): Promise<NameVerdict> {
  const verdict = moderateNameText(name);
  return verdict.ok ? { ok: true } : { ok: false, reason: "blocked", category: verdict.category };
}

export type NameModerator = typeof moderateName;
