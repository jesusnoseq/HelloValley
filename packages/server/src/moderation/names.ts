export type NameVerdict = { ok: true } | { ok: false; reason: "blocked" };

/**
 * Display-name moderation hook (GDD §3.3, §9.3; architecture §6.4: the server blocklist always
 * runs). Called by `POST /api/onboarding` after the name passed `PlayerNameSchema`.
 * TODO(M36): the real check: a normalised blocklist (case, accents, leetspeak, spacing) plus the
 * shard-wide offender list. Until then every schema-valid name is accepted.
 */
export async function moderateName(_name: string): Promise<NameVerdict> {
  return { ok: true };
}

export type NameModerator = typeof moderateName;
