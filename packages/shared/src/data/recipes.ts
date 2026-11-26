import type { ForageKind } from "./forage";
import type { ItemId } from "./items";
import type { NpcId } from "./npcs";

/** "Any fish" or "any mushroom" style ingredients. */
export type IngredientGroup = "fish" | ForageKind;

export type RecipeIngredient = { item: ItemId; qty: number } | { anyOf: IngredientGroup; qty: number };

/**
 * Cooking verbs shown on recipe cards (GDD §5.4: "recipe cards are written in the target
 * language"). Each one is a world label (`recipe.step.<verb>`), so the card reads entirely in the
 * target language with the words the label pipeline already generates (build plan M29).
 */
export const RECIPE_STEPS = ["mix", "knead", "bake", "whisk", "chop", "fry", "boil", "stir", "steep", "heat", "pour", "serve"] as const;
export type RecipeStep = (typeof RECIPE_STEPS)[number];

export interface RecipeDef {
  id: string;
  /** The item the kitchen produces. */
  result: ItemId;
  /** 2–3 ingredient lines (GDD §5.4). */
  ingredients: readonly RecipeIngredient[];
  /** The NPC who teaches it through the `teachRecipe` action. */
  teacher: NpcId;
  /** Hearts (0–10) needed before the teacher may teach it (architecture §6.1). */
  heartsRequired: number;
  /** The method, in order, as cooking verbs (the recipe card). */
  steps: readonly RecipeStep[];
}

/**
 * Recipes learned from NPCs and cooked in the apartment kitchen (GDD §5.4: the Baker teaches bread,
 * the Farmer teaches stew). Build plan M29: cooking, the learned-recipe book and the recipe cards
 * are in food/cooking.ts and food/recipeCard.ts.
 */
export const RECIPES = [
  { id: "bread", result: "bread", teacher: "baker", heartsRequired: 0, steps: ["mix", "knead", "bake"], ingredients: [{ item: "flour", qty: 2 }, { item: "milk", qty: 1 }] },
  {
    id: "berry_tart",
    result: "berry_tart",
    teacher: "baker",
    heartsRequired: 3,
    steps: ["mix", "pour", "bake"],
    ingredients: [{ item: "flour", qty: 1 }, { item: "egg", qty: 1 }, { item: "wild_berries", qty: 2 }],
  },
  { id: "omelette", result: "omelette", teacher: "farmer", heartsRequired: 0, steps: ["chop", "whisk", "fry"], ingredients: [{ item: "egg", qty: 2 }, { item: "onion", qty: 1 }] },
  {
    id: "fish_stew",
    result: "fish_stew",
    teacher: "farmer",
    heartsRequired: 2,
    steps: ["chop", "boil", "stir", "serve"],
    ingredients: [{ anyOf: "fish", qty: 1 }, { item: "potato", qty: 1 }, { item: "carrot", qty: 1 }],
  },
  { id: "herbal_tea", result: "herbal_tea", teacher: "doctor", heartsRequired: 1, steps: ["heat", "steep", "pour"], ingredients: [{ item: "wild_herb", qty: 1 }, { item: "mint", qty: 1 }] },
  { id: "hot_chocolate", result: "hot_chocolate", teacher: "barista", heartsRequired: 2, steps: ["heat", "stir", "pour"], ingredients: [{ item: "milk", qty: 1 }, { item: "sugar", qty: 1 }] },
  { id: "mushroom_soup", result: "mushroom_soup", teacher: "elder", heartsRequired: 3, steps: ["chop", "boil", "stir"], ingredients: [{ anyOf: "mushroom", qty: 2 }, { item: "milk", qty: 1 }] },
] as const satisfies readonly RecipeDef[];

export type RecipeId = (typeof RECIPES)[number]["id"];
export const RECIPE_IDS = RECIPES.map((r) => r.id) as readonly RecipeId[];

export function getRecipe(id: string): RecipeDef | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function recipesTaughtBy(npcId: NpcId): RecipeDef[] {
  return RECIPES.filter((r) => r.teacher === npcId);
}
