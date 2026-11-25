import apartmentBlock from "./apartment_block.json";
import bakery from "./bakery.json";
import cafe from "./cafe.json";
import clinic from "./clinic.json";
import elderCottage from "./elder_cottage.json";
import farm from "./farm.json";
import generalStore from "./general_store.json";
import gossipHouse from "./gossip_house.json";
import library from "./library.json";
import { BUILDING_RECIPE_IDS, type BuildingRecipe, type BuildingRecipeId, parseBuildingRecipe } from "./schema";
import townHall from "./town_hall.json";

/** The raw recipe files (src/buildings/*.json), keyed by building id. */
export const BUILDING_RECIPE_FILES: Readonly<Record<BuildingRecipeId, unknown>> = {
  apartment_block: apartmentBlock,
  bakery,
  farm,
  general_store: generalStore,
  clinic,
  cafe,
  gossip_house: gossipHouse,
  town_hall: townHall,
  library,
  elder_cottage: elderCottage,
};

let parsed: Readonly<Record<BuildingRecipeId, BuildingRecipe>> | undefined;

/** Every building recipe, validated with zod on first use (an invalid file throws). */
export function buildingRecipes(): Readonly<Record<BuildingRecipeId, BuildingRecipe>> {
  if (!parsed) {
    const out = {} as Record<BuildingRecipeId, BuildingRecipe>;
    for (const id of BUILDING_RECIPE_IDS) {
      const recipe = parseBuildingRecipe(BUILDING_RECIPE_FILES[id]);
      if (recipe.id !== id) throw new Error(`recipe file for ${id} declares id ${recipe.id}`);
      out[id] = recipe;
    }
    parsed = out;
  }
  return parsed;
}

export function buildingRecipe(id: BuildingRecipeId): BuildingRecipe {
  return buildingRecipes()[id];
}
