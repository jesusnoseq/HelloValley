import type { ForageKind } from "@hellovalley/shared";

/** Small pictures for the album and the pick-up notice, by forage kind. */
export const FORAGE_ICONS: Readonly<Record<ForageKind, string>> = {
  flower: "🌼",
  mushroom: "🍄",
  shell: "🐚",
  pebble: "🪨",
  berry: "🫐",
  herb: "🌿",
  rare_find: "🪙",
};

export const LOST_ICON = "✨";
