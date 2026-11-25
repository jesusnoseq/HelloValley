import type { ItemId } from "../data/items";
import type { KIT_INTERIOR_MODULE_IDS } from "./budgets";

export type InteriorModuleId = (typeof KIT_INTERIOR_MODULE_IDS)[number];

/** Which interior-kit module and variant shows a furniture item (GDD §5.6) when it is placed
 * in an apartment. The placement mode (M17, shared apartment/) takes the footprint from
 * `INTERIOR_FURNITURE`, which mirrors the module's `placement` in kits/interior/kit-manifest.json. */
export interface FurnitureLook {
  module: InteriorModuleId;
  variant: number;
}

export const FURNITURE_ITEM_LOOKS = {
  wooden_chair: { module: "chair", variant: 0 },
  small_table: { module: "table", variant: 1 },
  floor_lamp: { module: "lamp.floor", variant: 0 },
  round_rug: { module: "rug", variant: 0 },
  potted_plant: { module: "plant.potted", variant: 0 },
  bookshelf: { module: "shelf", variant: 0 },
} as const satisfies Partial<Record<ItemId, FurnitureLook>>;

export type FurnitureItemId = keyof typeof FURNITURE_ITEM_LOOKS;

export function furnitureLook(itemId: string): FurnitureLook | undefined {
  return Object.hasOwn(FURNITURE_ITEM_LOOKS, itemId) ? FURNITURE_ITEM_LOOKS[itemId as FurnitureItemId] : undefined;
}
