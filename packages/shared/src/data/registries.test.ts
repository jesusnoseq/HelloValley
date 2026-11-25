import { describe, expect, it } from "vitest";
import { ANIMALS, AnimalIdSchema, isAnimalId, isFurTintFor } from "./animals";
import { APARTMENT_DOORS, APARTMENT_FLOORS, ApartmentIdSchema, isApartmentId, parseApartmentId, randomApartmentId } from "./apartment";
import { FISH, FISHING_SPOTS, fishTable, getFish, isFishId } from "./fish";
import { FORAGE, FORAGE_ZONES, forageTable, LOST_ITEMS } from "./forage";
import { getItem, isConsumable, isItemId, ITEM_IDS, ItemIdSchema, ITEMS, npcBuys, npcSells, SHOPS } from "./items";
import { getNpc, isNpcId, NPC_IDS, NPC_RELATIONSHIPS, NpcIdSchema, NPCS, schedulePointAt } from "./npcs";
import { RARITIES, RARITY_WEIGHTS, withChances } from "./rarity";
import { RECIPES, recipesTaughtBy } from "./recipes";
import { BUILDING_IDS, clockToMinutes, PLACE_IDS, TIMES_OF_DAY, WEATHERS } from "./world";

const HEX = /^#[0-9a-f]{6}$/;

describe("animals", () => {
  it("has 16 animals with 3–4 natural fur tints each", () => {
    expect(ANIMALS).toHaveLength(16);
    expect(new Set(ANIMALS.map((a) => a.id)).size).toBe(16);
    for (const animal of ANIMALS) {
      expect(animal.furTints.length, animal.id).toBeGreaterThanOrEqual(3);
      expect(animal.furTints.length, animal.id).toBeLessThanOrEqual(4);
      expect(new Set(animal.furTints.map((t) => t.id)).size).toBe(animal.furTints.length);
      for (const tint of animal.furTints) expect(tint.hex).toMatch(HEX);
    }
  });

  it("validates ids and tints", () => {
    expect(isAnimalId("capybara")).toBe(true);
    expect(isAnimalId("dragon")).toBe(false);
    expect(AnimalIdSchema.safeParse("red_panda").success).toBe(true);
    expect(isFurTintFor("fox", "russet")).toBe(true);
    expect(isFurTintFor("fox", "polar")).toBe(false);
    expect(isFurTintFor("dragon", "russet")).toBe(false);
  });
});

describe("npcs", () => {
  it("has the nine villagers in registry order", () => {
    expect(NPCS.map((n) => n.id)).toEqual([...NPC_IDS]);
    expect(new Set(NPCS.map((n) => n.building)).size).toBe(9);
    for (const npc of NPCS) expect(BUILDING_IDS).toContain(npc.building);
    expect(isNpcId("baker")).toBe(true);
    expect(isNpcId("wizard")).toBe(false);
    expect(NpcIdSchema.safeParse("elder").success).toBe(true);
    expect(getNpc("doctor").voice.prebuiltVoice).toBe("Schedar");
    expect(getNpc("nobody")).toBeUndefined();
  });

  it("uses the voices from the NPC doc", () => {
    expect(Object.fromEntries(NPCS.map((n) => [n.id, n.voice.prebuiltVoice]))).toEqual({
      shopkeeper: "Puck",
      baker: "Sulafat",
      barista: "Zubenelgenubi",
      farmer: "Algenib",
      mayor: "Fenrir",
      librarian: "Sadaltager",
      doctor: "Schedar",
      gossip: "Sadachbia",
      elder: "Gacrux",
    });
  });

  it("likes and dislikes real items, never both", () => {
    for (const npc of NPCS) {
      for (const id of [...npc.likedItems, ...npc.dislikedItems]) expect(isItemId(id), `${npc.id}: ${id}`).toBe(true);
      const liked = new Set<string>(npc.likedItems);
      for (const id of npc.dislikedItems) expect(liked.has(id), `${npc.id}: ${id}`).toBe(false);
      expect(npc.likedItems.length).toBeGreaterThan(0);
    }
  });

  it("has 4–6 ordered schedule points at known places", () => {
    for (const npc of NPCS) {
      expect(npc.schedule.length, npc.id).toBeGreaterThanOrEqual(4);
      expect(npc.schedule.length, npc.id).toBeLessThanOrEqual(6);
      const minutes = npc.schedule.map((p) => clockToMinutes(p.at));
      for (const m of minutes) expect(m, npc.id).toBeTypeOf("number");
      expect([...minutes].sort((a, b) => a! - b!)).toEqual(minutes);
      expect(new Set(minutes).size).toBe(minutes.length);
      for (const p of npc.schedule) expect(PLACE_IDS).toContain(p.place);
    }
  });

  it("finds the active schedule point, wrapping past midnight", () => {
    const baker = getNpc("baker");
    expect(schedulePointAt(baker, 6 * 60)?.place).toBe("bakery");
    expect(schedulePointAt(baker, 12 * 60 + 30)).toEqual({ at: "12:00", place: "square_bench", activity: "eat" });
    expect(schedulePointAt(baker, 3 * 60)?.activity).toBe("sleep");
    expect(schedulePointAt(baker, 23 * 60 + 59)?.activity).toBe("sleep");
  });

  it("relationships reference real NPCs", () => {
    expect(NPC_RELATIONSHIPS).toHaveLength(7);
    for (const r of NPC_RELATIONSHIPS) {
      expect(isNpcId(r.a) && isNpcId(r.b)).toBe(true);
      expect(r.a).not.toBe(r.b);
    }
  });
});

describe("world", () => {
  it("parses clock times", () => {
    expect(clockToMinutes("00:00")).toBe(0);
    expect(clockToMinutes("06:30")).toBe(390);
    expect(clockToMinutes("23:59")).toBe(1439);
    expect(clockToMinutes("24:00")).toBeUndefined();
    expect(clockToMinutes("6:30")).toBeUndefined();
    expect(clockToMinutes("12:60")).toBeUndefined();
  });
});

describe("items", () => {
  it("has unique ids and round, small, non-negative integer prices", () => {
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    for (const id of ITEM_IDS) {
      const item = ITEMS[id];
      expect(item.id).toBe(id);
      expect(Number.isInteger(item.basePrice), id).toBe(true);
      expect(item.basePrice, id).toBeLessThanOrEqual(100);
      if (item.sellable) expect(item.basePrice, id).toBeGreaterThan(0);
      else expect(item.basePrice, id).toBe(0);
    }
  });

  it("includes every fish, forage find and lost item", () => {
    for (const f of FISH) expect(ITEMS[f.id]).toMatchObject({ category: "fish", basePrice: f.basePrice });
    for (const f of FORAGE) expect(ITEMS[f.id]).toMatchObject({ category: "forage", basePrice: f.basePrice });
    for (const l of LOST_ITEMS) expect(ITEMS[l.id]).toMatchObject({ category: "lost", sellable: false });
  });

  it("gives the GDD §5.4 buffs", () => {
    expect(ITEMS.bread.buff).toEqual({ kind: "walk_speed", amount: 0.1, durationSec: 300 });
    expect(ITEMS.coffee.buff).toEqual({ kind: "reply_hint", amount: 1, durationSec: 600 });
    expect(ITEMS.fish_stew.buff?.kind).toBe("fishing_luck");
    expect(ITEMS.cake.buff?.kind).toBe("happy_emote");
    for (const id of ITEM_IDS) {
      if (ITEMS[id].buff) expect(isConsumable(id), id).toBe(true);
    }
  });

  it("validates ids", () => {
    expect(getItem("bread")?.category).toBe("food");
    expect(getItem("toString")).toBeUndefined();
    expect(getItem("laser")).toBeUndefined();
    expect(ItemIdSchema.safeParse("salmon").success).toBe(true);
    expect(ItemIdSchema.safeParse("laser").success).toBe(false);
  });
});

describe("shops", () => {
  it("only list real, sellable items", () => {
    for (const [npcId, shop] of Object.entries(SHOPS)) {
      expect(isNpcId(npcId)).toBe(true);
      expect(shop.sells.length, npcId).toBeGreaterThan(0);
      for (const id of shop.sells) expect(ITEMS[id].sellable, `${npcId} sells ${id}`).toBe(true);
      if (shop.buys !== "any") for (const id of shop.buys) expect(ITEMS[id].sellable, `${npcId} buys ${id}`).toBe(true);
    }
  });

  it("follow the GDD §5.1 table", () => {
    expect(npcSells("baker", "bread")).toBe(true);
    expect(npcBuys("baker", "flour")).toBe(true);
    expect(npcBuys("baker", "egg")).toBe(true);
    expect(npcBuys("baker", "wild_berries")).toBe(true);
    expect(npcBuys("farmer", "chanterelle")).toBe(true);
    expect(npcBuys("farmer", "daisy")).toBe(true);
    expect(npcBuys("farmer", "river_shell")).toBe(false);
    expect(npcSells("barista", "coffee")).toBe(true);
    expect(npcBuys("barista", "coffee")).toBe(false);
    expect(npcBuys("doctor", "wild_herb")).toBe(true);
    expect(npcBuys("librarian", "old_letter")).toBe(true);
    expect(npcBuys("librarian", "old_coin")).toBe(true);
    expect(npcBuys("shopkeeper", "salmon")).toBe(true);
    expect(npcBuys("shopkeeper", "lost_glasses")).toBe(false);
    expect(npcSells("mayor", "cake")).toBe(false);
    expect(npcBuys("elder", "salmon")).toBe(false);
  });
});

describe("recipes", () => {
  it("combine 2–3 real ingredients into a real item, taught by a real NPC", () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const recipe of RECIPES) {
      expect(recipe.ingredients.length, recipe.id).toBeGreaterThanOrEqual(2);
      expect(recipe.ingredients.length, recipe.id).toBeLessThanOrEqual(3);
      expect(isItemId(recipe.result)).toBe(true);
      expect(isNpcId(recipe.teacher)).toBe(true);
      expect(recipe.heartsRequired).toBeGreaterThanOrEqual(0);
      expect(recipe.heartsRequired).toBeLessThanOrEqual(10);
      for (const ing of recipe.ingredients) {
        expect(ing.qty).toBeGreaterThan(0);
        if ("item" in ing) expect(isItemId(ing.item), `${recipe.id}: ${ing.item}`).toBe(true);
      }
    }
  });

  it("has the Baker teach bread and the Farmer teach stew", () => {
    expect(recipesTaughtBy("baker").map((r) => r.id)).toContain("bread");
    expect(recipesTaughtBy("farmer").map((r) => r.id)).toContain("fish_stew");
    expect(recipesTaughtBy("gossip")).toEqual([]);
  });
});

describe("fish", () => {
  it("has about 18 species with valid conditions", () => {
    expect(FISH).toHaveLength(18);
    expect(new Set(FISH.map((f) => f.id)).size).toBe(18);
    for (const f of FISH) {
      expect(RARITIES).toContain(f.rarity);
      expect(f.times.length).toBeGreaterThan(0);
      expect(f.weather.length).toBeGreaterThan(0);
      expect(f.spots.length).toBeGreaterThan(0);
    }
    expect(isFishId("eel")).toBe(true);
    expect(isFishId("bread")).toBe(false);
    expect(getFish("salmon")?.rarity).toBe("rare");
  });

  it("always has something biting, and legendary fish only in secret spots", () => {
    for (const timeOfDay of TIMES_OF_DAY) {
      for (const weather of WEATHERS) {
        for (const spot of FISHING_SPOTS) {
          const table = fishTable({ timeOfDay, weather, spot });
          expect(table.length, `${timeOfDay}/${weather}/${spot}`).toBeGreaterThan(0);
          for (const { value } of table) {
            const fish = getFish(value)!;
            expect(fish.times).toContain(timeOfDay);
            expect(fish.weather).toContain(weather);
            expect(fish.spots).toContain(spot);
            if (fish.rarity === "legendary") expect(spot).toBe("secret");
          }
        }
      }
    }
  });

  it("weights entries by rarity", () => {
    const table = fishTable({ timeOfDay: "night", weather: "fog", spot: "secret" });
    expect(table.find((e) => e.value === "ghost_pike")?.weight).toBe(RARITY_WEIGHTS.legendary);
    expect(table.find((e) => e.value === "minnow")?.weight).toBe(RARITY_WEIGHTS.common);
    expect(table.some((e) => e.value === "salmon")).toBe(false);
    const chances = withChances(table);
    expect(chances.reduce((sum, e) => sum + e.chance, 0)).toBeCloseTo(1);
    expect(withChances([])).toEqual([]);
  });

  it("every species can be caught somewhere", () => {
    const catchable = new Set<string>();
    for (const timeOfDay of TIMES_OF_DAY)
      for (const weather of WEATHERS)
        for (const spot of FISHING_SPOTS) for (const e of fishTable({ timeOfDay, weather, spot })) catchable.add(e.value);
    expect(catchable.size).toBe(FISH.length);
  });
});

describe("forage", () => {
  it("covers every zone and every find spawns somewhere", () => {
    const seen = new Set<string>();
    for (const zone of FORAGE_ZONES) {
      const table = forageTable(zone);
      expect(table.length, zone).toBeGreaterThan(0);
      for (const e of table) seen.add(e.value);
    }
    expect(seen.size).toBe(FORAGE.length);
  });

  it("lost items belong to NPCs and have hint places", () => {
    for (const lost of LOST_ITEMS) {
      expect(isNpcId(lost.owner)).toBe(true);
      expect(lost.hintPlaces.length).toBeGreaterThan(0);
      for (const p of lost.hintPlaces) expect(PLACE_IDS).toContain(p);
    }
  });
});

describe("apartment", () => {
  it("generates floor 1–9 + door A–H", () => {
    for (let i = 0; i < 200; i++) expect(randomApartmentId()).toMatch(/^[1-9][A-H]$/);
  });

  it("covers all 72 ids with an injected RNG, including edge values", () => {
    const ids = new Set<string>();
    for (let f = 0; f < 9; f++) {
      for (let d = 0; d < 8; d++) {
        const values = [(f + 0.5) / 9, (d + 0.5) / 8];
        ids.add(randomApartmentId(() => values.shift()!));
      }
    }
    expect(ids.size).toBe(APARTMENT_FLOORS.length * APARTMENT_DOORS.length);
    expect(randomApartmentId(() => 0)).toBe("1A");
    expect(randomApartmentId(() => 0.999999)).toBe("9H");
    expect(randomApartmentId(() => 1)).toBe("9H");
    expect(randomApartmentId(() => -1)).toBe("1A");
    expect(randomApartmentId(() => Number.NaN)).toBe("1A");
  });

  it("validates and parses ids", () => {
    expect(isApartmentId("6D")).toBe(true);
    expect(isApartmentId("0A")).toBe(false);
    expect(isApartmentId("6I")).toBe(false);
    expect(isApartmentId("6d")).toBe(false);
    expect(isApartmentId("10A")).toBe(false);
    expect(ApartmentIdSchema.safeParse("9H").success).toBe(true);
    expect(parseApartmentId("6D")).toEqual({ floor: 6, door: "D" });
  });
});
