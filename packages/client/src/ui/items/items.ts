import { getItem, type ItemCategory, itemLabelKey, isItemId, labelEnglish } from "@hellovalley/shared";
import type { LabelMap } from "../../labels/labelSource";

/**
 * An item's name: its world label in the target language when loaded (build plan M25, GDD §6.5:
 * names are practice too), else the id as readable English.
 */
export function itemName(id: string, labels?: LabelMap | null): string {
  const label = labels?.[`item.${id}`]?.word;
  if (label) return label;
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The English source word of an item's label (the tooltip under the target-language word). */
export function itemEnglish(id: string): string {
  return isItemId(id) ? labelEnglish(itemLabelKey(id)) : itemName(id);
}

const CATEGORY_ICONS: Record<ItemCategory, string> = {
  food: "🍞",
  drink: "☕",
  ingredient: "🧺",
  remedy: "💊",
  seed: "🌱",
  tool: "🧰",
  furniture: "🪑",
  gift: "🎁",
  book: "📘",
  fish: "🐟",
  forage: "🍄",
  lost: "❔",
};

/** A small picture for an inventory slot, by item category (TODO(no milestone yet): item icons rendered from the kits). */
export function itemIcon(id: string): string {
  const category = getItem(id)?.category;
  return category ? CATEGORY_ICONS[category] : "❔";
}
