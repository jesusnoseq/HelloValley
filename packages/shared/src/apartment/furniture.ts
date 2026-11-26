import { FURNITURE_ITEM_LOOKS, type FurnitureItemId } from "../assets/interior";
import { INTERIOR_FURNITURE, type FurnitureModuleId } from "../world/interiors";

/**
 * The furniture an apartment can hold (build plan M17, GDD §4.2): each id names an interior-kit
 * module and variant (M08) whose placement footprint comes from `INTERIOR_FURNITURE`. Two kinds:
 *
 * - **Studio pieces** come with every apartment (the M13 starting furniture). The kitchen nook
 *   and the mirror are built-ins (`fixed`): the kitchen is where cooking happens (TODO(M29)) and
 *   the mirror is the appearance editor's interactable (M15), so they stay where they are.
 * - **Shop furniture** is the `furniture` items of `data/items.ts` (their look is
 *   `FURNITURE_ITEM_LOOKS`). The studio starts with some of them already placed.
 *
 * Layout documents store these ids in the `itemId` field (GDD §9.4).
 * Build plan M26: furniture bought from the Shopkeeper lands in the inventory like any item (it can
 * be sold back or gifted from there). TODO(no milestone yet): moving a piece between the inventory
 * and the apartment's storage (both server-written; the live ApartmentRoom owns the layout).
 */

export interface FurnitureDef {
  module: FurnitureModuleId;
  variant: number;
  /** A built-in: it cannot be moved or stored. */
  fixed: boolean;
  /** True for shop furniture (an item id in data/items.ts). */
  item: boolean;
}

const studio = (module: FurnitureModuleId, variant: number, fixed = false): FurnitureDef => ({ module, variant, fixed, item: false });

const STUDIO_FURNITURE = {
  kitchen_nook: studio("kitchen.nook", 0, true),
  mirror: studio("mirror", 0, true),
  bed: studio("bed", 0),
  wardrobe: studio("wardrobe", 0),
  sofa: studio("sofa", 1),
  painting: studio("painting", 0),
  table_lamp: studio("lamp.table", 0),
  fern: studio("plant.potted", 1),
  pantry_shelf: studio("shelf", 2),
} as const satisfies Record<string, FurnitureDef>;

const SHOP_FURNITURE = Object.fromEntries(
  Object.entries(FURNITURE_ITEM_LOOKS).map(([id, look]) => [id, { module: look.module, variant: look.variant, fixed: false, item: true }]),
) as Record<FurnitureItemId, FurnitureDef>;

export type StudioFurnitureId = keyof typeof STUDIO_FURNITURE;
export type FurnitureId = StudioFurnitureId | FurnitureItemId;

export const APARTMENT_FURNITURE: Readonly<Record<FurnitureId, FurnitureDef>> = { ...STUDIO_FURNITURE, ...SHOP_FURNITURE };

export const FURNITURE_IDS = Object.keys(APARTMENT_FURNITURE) as [FurnitureId, ...FurnitureId[]];

export function isFurnitureId(value: unknown): value is FurnitureId {
  return typeof value === "string" && Object.hasOwn(APARTMENT_FURNITURE, value);
}

export function furnitureDef(id: FurnitureId): FurnitureDef {
  return APARTMENT_FURNITURE[id];
}

/** The placement rules of a furniture id's module (footprint in 0.5 m cells, mount, against a wall). */
export function furnitureFootprint(id: FurnitureId) {
  return INTERIOR_FURNITURE[APARTMENT_FURNITURE[id].module];
}
