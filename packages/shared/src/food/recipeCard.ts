import { FORAGE_KINDS } from "../data/forage";
import { itemLabelKey } from "../data/items";
import { getRecipe, type IngredientGroup, RECIPE_STEPS, type RecipeId, type RecipeStep } from "../data/recipes";

/**
 * Recipe cards (GDD §5.4: "recipe cards are written in the target language"; build plan M29).
 * A card is built only from world labels (GDD §6.5): the dish, each ingredient with its amount, the
 * "any fish" style groups and the cooking verbs. The words come from the same per-language label
 * pipeline as every other label (seeded `cache/labels/{lang}`, else generated once per player), so
 * the card costs no extra model call and every word on it can be clicked into the notebook.
 */

export const RECIPE_CARD_LABEL_KEYS = {
  /** The card's heading word ("recipe"). */
  recipe: "recipe.card",
  ingredients: "recipe.ingredients",
  method: "recipe.method",
  cook: "recipe.cook",
} as const;

export const RECIPE_CARD_WORDS: Readonly<Record<(typeof RECIPE_CARD_LABEL_KEYS)[keyof typeof RECIPE_CARD_LABEL_KEYS], string>> = {
  "recipe.card": "recipe",
  "recipe.ingredients": "ingredients",
  "recipe.method": "method",
  "recipe.cook": "cook",
};

export const recipeStepLabelKey = (step: RecipeStep) => `recipe.step.${step}`;
export const ingredientGroupLabelKey = (group: IngredientGroup) => `recipe.group.${group}`;

/** Every recipe-card label key with its English source word (merged into the world label registry). */
export function recipeCardLabels(): Record<string, string> {
  const out: Record<string, string> = { ...RECIPE_CARD_WORDS };
  for (const step of RECIPE_STEPS) out[recipeStepLabelKey(step)] = step;
  out[ingredientGroupLabelKey("fish")] = "any fish";
  for (const kind of FORAGE_KINDS) out[ingredientGroupLabelKey(kind)] = `any ${kind.replace(/_/g, " ")}`;
  return out;
}

export interface RecipeCardLine {
  /** The ingredient's label key (an item, or an "any …" group). */
  labelKey: string;
  qty: number;
}

export interface RecipeCardModel {
  recipeId: RecipeId;
  /** The dish's label key. */
  titleKey: string;
  lines: RecipeCardLine[];
  /** Cooking verb label keys, in order. */
  steps: string[];
}

/** The card of a recipe, as label keys (the client fills in the target-language words). */
export function recipeCard(recipeId: RecipeId): RecipeCardModel {
  const recipe = getRecipe(recipeId)!;
  return {
    recipeId,
    titleKey: itemLabelKey(recipe.result),
    lines: recipe.ingredients.map((line) => ({ labelKey: "item" in line ? itemLabelKey(line.item) : ingredientGroupLabelKey(line.anyOf), qty: line.qty })),
    steps: recipe.steps.map(recipeStepLabelKey),
  };
}
