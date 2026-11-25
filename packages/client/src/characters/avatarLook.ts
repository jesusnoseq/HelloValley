import { type AvatarAppearance, appearanceHex, type CharacterLook } from "@hellovalley/shared";
import { assembleCharacter, type Character, type CharacterAssets } from "./characterGlb";

/**
 * A player's appearance (profile `animal` + `colors`) as a generated character (build plan M15).
 * Clothes may be custom HSL colours, so the tints are passed as hex instead of swatch ids.
 * TODO(M16): the same for remote avatars from the room state. Optional parts (floppy ears,
 * antlers, flippers) keep their defaults: the profile has no field for them yet.
 */
export function avatarLook(appearance: AvatarAppearance): CharacterLook {
  // The swatches are placeholders: appearanceHex supplies the real clothing colours.
  return { animal: appearance.animal, furTint: appearance.colors.fur, shirt: "cream", trousers: "cream" };
}

export function assembleAvatar(assets: CharacterAssets, appearance: AvatarAppearance): Character {
  return assembleCharacter(assets, avatarLook(appearance), appearanceHex(appearance));
}

/** Re-tints fur and clothes in place (same animal). */
export function tintAvatar(character: Character, appearance: AvatarAppearance): void {
  const hex = appearanceHex(appearance);
  character.setTint("fur", hex.fur);
  character.setTint("shirt", hex.shirt);
  character.setTint("trousers", hex.trousers);
}
