import { z } from "zod";
import { AnimalIdSchema, getAnimal, isFurTintFor } from "../data/animals";
import { clothingColorHex } from "../data/palette";
import { AvatarColorsSchema, type PlayerProfile, PlayerProfileSchema } from "../firestore/schemas";

/**
 * A player's appearance (GDD §3, build plan M15): the animal plus fur, shirt and trousers
 * colours. It is the part of `users/{uid}` the apartment mirror edits. The name is not part of
 * it: it is moderated and set at onboarding (a rename is TODO(M36)).
 *
 * Persistence (my choice, see pending.md M15): the mirror saves through the game server,
 * `PUT /api/profile/appearance`, rather than writing Firestore from the client. The server
 * parses the body with this schema (so custom HSL colours are clamped to the pastel range, not
 * just rejected the way `firestore.rules` does), checks that the fur tint belongs to the animal
 * (the rules cannot) and pushes the new look to the player's TownRoom (build plan M16).
 * The rules still allow a direct owner update of `animal`/`colors` (architecture §8.1), which
 * stays compatible: both paths write the same validated shape.
 */
export const AvatarAppearanceSchema = z
  .strictObject({
    animal: AnimalIdSchema,
    colors: AvatarColorsSchema,
  })
  .refine((a) => isFurTintFor(a.animal, a.colors.fur), {
    message: "fur tint does not belong to the animal",
    path: ["colors", "fur"],
  });
/** What a client sends (HSL colours may be out of range; parsing clamps them). */
export type AvatarAppearanceInput = z.input<typeof AvatarAppearanceSchema>;
export type AvatarAppearance = z.output<typeof AvatarAppearanceSchema>;

/** The body of `PUT /api/profile/appearance`. */
export const AppearanceUpdateRequestSchema = AvatarAppearanceSchema;
export type AppearanceUpdateRequest = AvatarAppearanceInput;

/** `PUT /api/profile/appearance` 200 body: the whole updated profile. */
export const AppearanceUpdateResponseSchema = z.strictObject({ profile: PlayerProfileSchema });
export type AppearanceUpdateResponse = z.infer<typeof AppearanceUpdateResponseSchema>;

/** Error codes of `PUT /api/profile/appearance` (4xx JSON body `{ error, message }`). */
export const APPEARANCE_ERRORS = ["invalid_request", "not_onboarded"] as const;
export type AppearanceError = (typeof APPEARANCE_ERRORS)[number];

export function appearanceOf(profile: Pick<PlayerProfile, "animal" | "colors">): AvatarAppearance {
  return { animal: profile.animal, colors: profile.colors };
}

/** The profile with a new appearance (everything else unchanged). */
export function withAppearance<P extends Pick<PlayerProfile, "animal" | "colors">>(profile: P, appearance: AvatarAppearance): P {
  return { ...profile, animal: appearance.animal, colors: appearance.colors };
}

/** The sRGB hex colours an appearance renders with. An unknown fur tint falls back to the animal's first tint. */
export function appearanceHex(appearance: Pick<AvatarAppearance, "animal" | "colors">): { fur: string; shirt: string; trousers: string } {
  const animal = getAnimal(appearance.animal);
  const tints = animal?.furTints ?? [];
  const fur = tints.find((t) => t.id === appearance.colors.fur)?.hex ?? tints[0]?.hex ?? "#c8a27a";
  return { fur, shirt: clothingColorHex(appearance.colors.shirt), trousers: clothingColorHex(appearance.colors.trousers) };
}

/** True when two appearances look the same (same animal, fur and clothing colours). */
export function sameAppearance(a: AvatarAppearance, b: AvatarAppearance): boolean {
  if (a.animal !== b.animal || a.colors.fur !== b.colors.fur) return false;
  const ha = appearanceHex(a);
  const hb = appearanceHex(b);
  return ha.shirt === hb.shirt && ha.trousers === hb.trousers && sameKind(a.colors.shirt, b.colors.shirt) && sameKind(a.colors.trousers, b.colors.trousers);
}

function sameKind(a: object, b: object): boolean {
  return "swatch" in a === "swatch" in b;
}
