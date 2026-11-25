import { type AvatarAppearance, AvatarAppearanceSchema, sameAppearance } from "@hellovalley/shared";
import type { AppearanceDraft } from "../onboarding/draft";

/**
 * The apartment mirror's editing state (build plan M15), kept pure so it is unit-tested: the
 * saved appearance becomes an editor draft, and a draft becomes the appearance to preview live and
 * to send to `PUT /api/profile/appearance`.
 */

export function draftFromAppearance(a: AvatarAppearance): AppearanceDraft {
  return { animal: a.animal, fur: a.colors.fur, shirt: a.colors.shirt, trousers: a.colors.trousers };
}

/** The appearance a draft describes (custom colours clamped), or null when it is invalid. */
export function appearanceFromDraft(d: AppearanceDraft): AvatarAppearance | null {
  const parsed = AvatarAppearanceSchema.safeParse({ animal: d.animal, colors: { fur: d.fur, shirt: d.shirt, trousers: d.trousers } });
  return parsed.success ? parsed.data : null;
}

/** True when saving the draft would change the saved appearance. */
export function isDirty(saved: AvatarAppearance, d: AppearanceDraft): boolean {
  const next = appearanceFromDraft(d);
  return next !== null && !sameAppearance(saved, next);
}
