import { FISH } from "../data/fish";
import { type ForageKind, forageIdsOfKind } from "../data/forage";
import { ITEMS, type ItemId } from "../data/items";
import type { NpcId } from "../data/npcs";
import { getRecipe, type IngredientGroup, RECIPE_IDS, type RecipeDef, type RecipeId, type RecipeIngredient } from "../data/recipes";
import { applyItemDeltas, type ItemDelta, itemCounts, type SlotEntry, TOTAL_SLOTS } from "../npc/inventory";
import { interiorLayout } from "../world/interiors";
import type { SpaceId } from "../world/player";
import type { Vec2 } from "../world/town";

/**
 * Cooking in the apartment kitchen (GDD §5.4, build plan M29): a recipe the player learned from
 * its teacher (`teachRecipe`, kept in the recipe book) turns its 2–3 ingredients into the dish.
 * The server checks everything (`cook:make {recipeId}`): the player stands at the kitchen nook of
 * an apartment (its spot is fixed: the nook is a built-in, apartment/furniture.ts), knows the
 * recipe, holds the ingredients and has room for the dish, and applies it in one transaction.
 * "Any fish" / "any mushroom" lines take the cheapest one the player holds (ties: the biggest
 * stack), so a rare catch is never cooked by accident.
 */

/** How close to the kitchen spot the player must stand (my number). */
export const KITCHEN_REACH_M = 1;
/** Slack on the reach for the server check. */
export const KITCHEN_SLACK_M = 0.5;
/** Shortest gap between two dishes (my number). */
export const COOK_COOLDOWN_MS = 1500;

/** Where the player stands to cook in an apartment. */
export function kitchenSpot(): Vec2 {
  return interiorLayout("apartment").spots.kitchen!;
}

export function atKitchen(space: SpaceId, pos: Vec2, slack = 0): boolean {
  if (space !== "apartment") return false;
  const spot = kitchenSpot();
  return Math.hypot(pos[0] - spot[0], pos[1] - spot[1]) <= KITCHEN_REACH_M + slack;
}

// ---------------------------------------------------------------------------------------------
// The recipe book (`users/{uid}/collections/recipes`, server-only)

export interface RecipeBookEntry {
  /** Who taught it. */
  teacher: NpcId;
  /** The target language of the conversation it was taught in. */
  lang: string;
  learnedMs: number;
  /** Dishes cooked from it. */
  cooked: number;
}

export interface RecipeBook {
  known: Partial<Record<RecipeId, RecipeBookEntry>>;
}

export const emptyRecipeBook = (): RecipeBook => ({ known: {} });

export function isRecipeId(id: string): id is RecipeId {
  return (RECIPE_IDS as readonly string[]).includes(id);
}

export function knownRecipeIds(book: RecipeBook): RecipeId[] {
  return RECIPE_IDS.filter((id) => book.known[id] !== undefined);
}

/** Adds recipes the server accepted from a `teachRecipe`; ones already known stay as they were. */
export function learnRecipes(book: RecipeBook, ids: readonly string[], teacher: NpcId, lang: string, nowMs: number): { book: RecipeBook; learned: RecipeId[] } {
  const known = { ...book.known };
  const learned: RecipeId[] = [];
  for (const id of ids) {
    if (!isRecipeId(id) || known[id]) continue;
    known[id] = { teacher, lang, learnedMs: nowMs, cooked: 0 };
    learned.push(id);
  }
  return { book: { known }, learned };
}

/** Counts a dish. */
export function recordCooked(book: RecipeBook, recipeId: RecipeId): RecipeBook {
  const entry = book.known[recipeId];
  if (!entry) return book;
  return { known: { ...book.known, [recipeId]: { ...entry, cooked: entry.cooked + 1 } } };
}

// ---------------------------------------------------------------------------------------------
// Ingredients

/** The items an "any …" line accepts. */
export function groupItems(group: IngredientGroup): ItemId[] {
  if (group === "fish") return FISH.map((f) => f.id as ItemId);
  return forageIdsOfKind(group as ForageKind) as ItemId[];
}

export interface IngredientUse {
  itemId: ItemId;
  qty: number;
}

export type CookPlan = { ok: true; uses: IngredientUse[] } | { ok: false; missing: RecipeIngredient[] };

/** Which items a recipe would use from what the player holds (or what is missing). Pure. */
export function planCooking(recipe: Pick<RecipeDef, "ingredients">, counts: Readonly<Partial<Record<string, number>>>): CookPlan {
  const left: Partial<Record<string, number>> = { ...counts };
  const uses: IngredientUse[] = [];
  const missing: RecipeIngredient[] = [];
  // Exact items first, so an "any" line cannot take what a named line needs.
  const ordered = [...recipe.ingredients].sort((a, b) => Number("anyOf" in a) - Number("anyOf" in b));
  for (const line of ordered) {
    if ("item" in line) {
      if ((left[line.item] ?? 0) < line.qty) {
        missing.push(line);
        continue;
      }
      left[line.item] = (left[line.item] ?? 0) - line.qty;
      uses.push({ itemId: line.item, qty: line.qty });
      continue;
    }
    const candidates = groupItems(line.anyOf)
      .filter((id) => (left[id] ?? 0) >= line.qty)
      .sort((a, b) => ITEMS[a].basePrice - ITEMS[b].basePrice || (left[b] ?? 0) - (left[a] ?? 0) || a.localeCompare(b));
    const pick = candidates[0];
    if (!pick) {
      missing.push(line);
      continue;
    }
    left[pick] = (left[pick] ?? 0) - line.qty;
    uses.push({ itemId: pick, qty: line.qty });
  }
  return missing.length ? { ok: false, missing } : { ok: true, uses };
}

export type CookRefusal = "unknown_recipe" | "not_known" | "not_at_kitchen" | "missing_ingredients" | "bag_full" | "cooldown" | "busy" | "unavailable";

export type CookOutcome =
  | { ok: true; recipeId: RecipeId; result: ItemId; uses: IngredientUse[]; slots: SlotEntry[]; changed: number[]; book: RecipeBook }
  | { ok: false; reason: CookRefusal; missing?: RecipeIngredient[] };

/**
 * The pure part of `cook:make` inside the store's transaction: the recipe must be in the book and
 * every ingredient held; the ingredients leave the bag and the dish goes in (all or nothing).
 */
export function cookRecipe(slots: readonly SlotEntry[], book: RecipeBook, recipeId: string): CookOutcome {
  const recipe = getRecipe(recipeId);
  if (!recipe || !isRecipeId(recipe.id)) return { ok: false, reason: "unknown_recipe" };
  if (!book.known[recipe.id]) return { ok: false, reason: "not_known" };
  const plan = planCooking(recipe, itemCounts(slots));
  if (!plan.ok) return { ok: false, reason: "missing_ingredients", missing: plan.missing };
  const deltas: ItemDelta[] = [...plan.uses.map((u) => ({ itemId: u.itemId, qty: -u.qty })), { itemId: recipe.result, qty: 1 }];
  const items = applyItemDeltas(slots, deltas, TOTAL_SLOTS);
  if (!items.ok) return { ok: false, reason: items.reason === "inventory_full" ? "bag_full" : "missing_ingredients" };
  return { ok: true, recipeId: recipe.id, result: recipe.result, uses: plan.uses, slots: items.slots, changed: items.changed, book: recordCooked(book, recipe.id) };
}
