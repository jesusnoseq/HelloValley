import type { CharacterLook } from "@hellovalley/shared";

/**
 * Look of the local player until avatars render from the profile (build plan M13 uses a
 * placeholder). TODO(M15): build the avatar from the player's profile (animal, fur, clothes,
 * name tag) with the animation state machine.
 */
export const PLACEHOLDER_LOOK: CharacterLook = { animal: "fox", furTint: "russet", shirt: "sky", trousers: "navy" };
