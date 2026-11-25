import type { AvatarAppearance } from "@hellovalley/shared";

/**
 * The avatar used where there is no profile: the dev pages (`/dev/play`, no sign-in). Signed-in
 * players render from their profile (state/avatarStore, build plan M15).
 */
export const PLACEHOLDER_APPEARANCE: AvatarAppearance = {
  animal: "fox",
  colors: { fur: "russet", shirt: { swatch: "sky" }, trousers: { swatch: "navy" } },
};
export const PLACEHOLDER_NAME = "Guest";
