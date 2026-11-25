import { describe, expect, it } from "vitest";
import { ITEMS } from "../data/items";
import { KIT_INTERIOR_MODULE_IDS, isRoomPanelModuleId } from "./budgets";
import { FURNITURE_ITEM_LOOKS, furnitureLook } from "./interior";

describe("furniture item looks", () => {
  it("gives every furniture item an interior furniture module", () => {
    const furniture = Object.values(ITEMS)
      .filter((item) => item.category === "furniture")
      .map((item) => item.id)
      .sort();
    expect(Object.keys(FURNITURE_ITEM_LOOKS).sort()).toEqual(furniture);
    for (const look of Object.values(FURNITURE_ITEM_LOOKS)) {
      expect(KIT_INTERIOR_MODULE_IDS).toContain(look.module);
      expect(isRoomPanelModuleId(look.module)).toBe(false);
      expect(look.variant).toBeGreaterThanOrEqual(0);
      expect(look.variant).toBeLessThan(3);
    }
  });

  it("looks items up safely", () => {
    expect(furnitureLook("wooden_chair")).toEqual({ module: "chair", variant: 0 });
    expect(furnitureLook("bread")).toBeUndefined();
    expect(furnitureLook("toString")).toBeUndefined();
  });
});
