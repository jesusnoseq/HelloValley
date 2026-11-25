import { describe, expect, it } from "vitest";
import { ITEMS } from "../data/items";
import { ApartmentLayoutSchema } from "../firestore/schemas";
import { INTERIOR_FURNITURE, INTERIOR_LAYOUTS } from "../world/interiors";
import { isWalkable } from "../world/navgrid";
import { APARTMENT_FURNITURE, FURNITURE_IDS, type FurnitureId } from "./furniture";
import {
  type ApartmentLayoutData,
  apartmentInteriorLayout,
  apartmentNavGrid,
  applyFurnitureEdit,
  DEFAULT_APARTMENT_LAYOUT,
  defaultApartmentLayout,
  type FurnitureEdit,
  furnitureAt,
  layoutOrDefault,
  layoutProblems,
  needsWall,
  openApartmentNavGrid,
  snapPlacement,
} from "./layout";

const D = DEFAULT_APARTMENT_LAYOUT;
const indexOf = (id: FurnitureId, nth = 0) => D.furniture.map((e, k) => [e.itemId, k] as const).filter(([i]) => i === id)[nth]![1];

function edit(e: FurnitureEdit, layout: ApartmentLayoutData = defaultApartmentLayout()) {
  return applyFurnitureEdit(layout, e);
}

function applied(e: FurnitureEdit, layout?: ApartmentLayoutData): ApartmentLayoutData {
  const r = edit(e, layout);
  if (!r.ok) throw new Error(`${r.reason}: ${r.problems.join("; ")}`);
  return r.layout;
}

const chair = indexOf("wooden_chair");
const table = indexOf("small_table");
const lamp = indexOf("table_lamp");

describe("apartment furniture catalogue", () => {
  it("maps every id to an interior-kit module, and shop furniture to furniture items", () => {
    for (const id of FURNITURE_IDS) {
      const def = APARTMENT_FURNITURE[id];
      expect(INTERIOR_FURNITURE[def.module], id).toBeDefined();
      expect(def.variant >= 0 && def.variant <= 2, id).toBe(true);
      if (def.item) expect(ITEMS[id as keyof typeof ITEMS]?.category, id).toBe("furniture");
    }
    expect(FURNITURE_IDS.filter((id) => APARTMENT_FURNITURE[id].fixed).sort()).toEqual(["kitchen_nook", "mirror"]);
  });
});

describe("default apartment layout", () => {
  it("is the M13 studio, piece for piece", () => {
    const pieces = apartmentInteriorLayout(D).furniture;
    expect(pieces).toEqual(INTERIOR_LAYOUTS.apartment.furniture);
  });

  it("passes the placement rules and the Firestore schema", () => {
    expect(layoutProblems(D)).toEqual([]);
    expect(ApartmentLayoutSchema.parse(D)).toEqual(D);
    expect(ApartmentLayoutSchema.parse({ furniture: D.furniture })).toEqual(D);
    expect(ApartmentLayoutSchema.safeParse({ furniture: [{ itemId: "throne", x: 0, z: 0, rot: 0 }] }).success).toBe(false);
  });

  it("is used when the stored layout is missing or breaks the rules", () => {
    expect(layoutOrDefault(null)).toEqual(D);
    const broken = defaultApartmentLayout();
    broken.furniture[chair]!.x = 2; // onto the table
    expect(layoutOrDefault(broken)).toEqual(D);
    const moved = applied({ op: "move", index: chair, itemId: "wooden_chair", x: 1.5, z: 2.5, rot: 0 });
    expect(layoutOrDefault(moved)).toEqual(moved);
  });
});

describe("furniture edits", () => {
  it("rotates and moves a piece on the 0.5 m grid", () => {
    const turned = applied({ op: "move", index: chair, itemId: "wooden_chair", x: 1.5, z: 2.5, rot: 0 });
    expect(turned.furniture[chair]).toEqual({ itemId: "wooden_chair", x: 1.5, z: 2.5, rot: 0 });
    const moved = applied({ op: "move", index: chair, itemId: "wooden_chair", x: 4.5, z: 1, rot: 180 });
    expect(moved.furniture[chair]).toEqual({ itemId: "wooden_chair", x: 4.5, z: 1, rot: 180 });
    // The input layout is never changed.
    expect(D.furniture[chair]).toEqual({ itemId: "wooden_chair", x: 1.5, z: 2.5, rot: 90 });
  });

  it("refuses overlaps, off-grid spots, the outside and the doorway", () => {
    const at = (x: number, z: number) => edit({ op: "move", index: chair, itemId: "wooden_chair", x, z, rot: 0 });
    for (const [x, z, why] of [
      [2, 2, /overlaps/],
      [1.25, 2.5, /grid/],
      [5.75, 1, /outside the room/],
      [2.5, 4, /entrance/],
    ] as const) {
      const r = at(x, z);
      expect(r.ok, `${x}, ${z}`).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("invalid");
        expect(r.problems.join("; ")).toMatch(why);
      }
    }
  });

  it("keeps wall pieces on a wall and off the windows", () => {
    const painting = indexOf("painting");
    const off = edit({ op: "move", index: painting, itemId: "painting", x: 3, z: 1, rot: 0 });
    expect(!off.ok && off.problems.join()).toMatch(/back must be on a wall/);
    const overWindow = edit({ op: "move", index: painting, itemId: "painting", x: 2, z: 0, rot: 0 });
    expect(!overWindow.ok && overWindow.problems.join()).toMatch(/hangs over a window/);
    const onEast = edit({ op: "move", index: painting, itemId: "painting", x: 5.5, z: 3.5, rot: 270 });
    expect(onEast.ok).toBe(true);
    // Two wall pieces cannot hang on top of each other.
    const onMirror = edit({ op: "move", index: painting, itemId: "painting", x: 0, z: 2.5, rot: 90 });
    expect(!onMirror.ok && onMirror.problems.join()).toMatch(/mirror#\d+ overlaps painting/);
  });

  it("never moves or stores the built-ins", () => {
    expect(edit({ op: "move", index: indexOf("kitchen_nook"), itemId: "kitchen_nook", x: 0, z: 0, rot: 0 })).toMatchObject({ ok: false, reason: "fixed" });
    expect(edit({ op: "store", index: indexOf("mirror"), itemId: "mirror" })).toMatchObject({ ok: false, reason: "fixed" });
    const hacked = defaultApartmentLayout();
    hacked.furniture = hacked.furniture.filter((e) => e.itemId !== "mirror");
    expect(layoutProblems(hacked).join()).toMatch(/mirror is a built-in/);
    expect(layoutProblems({ ...defaultApartmentLayout(), stored: ["kitchen_nook"] }).join()).toMatch(/cannot be stored/);
  });

  it("stores a piece and places it again", () => {
    const stored = applied({ op: "store", index: chair, itemId: "wooden_chair" });
    expect(stored.furniture).toHaveLength(D.furniture.length - 1);
    expect(stored.stored).toEqual(["wooden_chair"]);
    const placed = applied({ op: "place", itemId: "wooden_chair", x: 4.5, z: 1, rot: 0 }, stored);
    expect(placed.stored).toEqual([]);
    expect(placed.furniture.at(-1)).toEqual({ itemId: "wooden_chair", x: 4.5, z: 1, rot: 0 });
    expect(edit({ op: "place", itemId: "bed", x: 4.5, z: 1, rot: 0 }, stored)).toMatchObject({ ok: false, reason: "not_stored" });
  });

  it("refuses an edit made against an outdated layout", () => {
    expect(edit({ op: "move", index: chair, itemId: "bed", x: 4.5, z: 1, rot: 0 })).toMatchObject({ ok: false, reason: "not_found" });
    expect(edit({ op: "store", index: 39, itemId: "bed" })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("carries the table lamp with the table, and stores it with it", () => {
    const moved = applied({ op: "move", index: table, itemId: "small_table", x: 3.5, z: 2.5, rot: 90 });
    expect(moved.furniture[table]).toMatchObject({ x: 3.5, z: 2.5, rot: 90 });
    expect(moved.furniture[lamp]).toEqual({ itemId: "table_lamp", x: 3.75, z: 2.75, rot: 90 });
    const stored = applied({ op: "store", index: table, itemId: "small_table" });
    expect(stored.stored.sort()).toEqual(["small_table", "table_lamp"]);
    expect(stored.furniture.some((e) => e.itemId === "table_lamp")).toBe(false);
  });

  it("puts table-top pieces only on a table", () => {
    const r = edit({ op: "move", index: lamp, itemId: "table_lamp", x: 4.5, z: 1, rot: 0 });
    expect(!r.ok && r.problems.join()).toMatch(/must stand on a table/);
    expect(edit({ op: "move", index: lamp, itemId: "table_lamp", x: 2.5, z: 2.5, rot: 0 }).ok).toBe(true);
  });

  it("keeps the mirror and the kitchen reachable from the door", () => {
    // A row of chairs across the room cuts the kitchen off from the door.
    const fenced = defaultApartmentLayout();
    fenced.furniture = fenced.furniture.filter((e) => ["kitchen_nook", "mirror"].includes(e.itemId));
    for (let x = 0; x < 6; x += 0.5) fenced.furniture.push({ itemId: "wooden_chair", x, z: 1.5, rot: 0 });
    expect(layoutProblems(fenced)).toEqual(["the kitchen cannot be reached from the door"]);
    fenced.furniture.splice(fenced.furniture.length - 3, 1); // a gap at x = 4.5
    expect(layoutProblems(fenced)).toEqual([]);
  });
});

describe("placement helpers", () => {
  it("snaps a ghost to the grid inside the room", () => {
    expect(snapPlacement("wooden_chair", [1.3, 1.3], 0)).toEqual({ x: 1, z: 1, rot: 0 });
    expect(snapPlacement("small_table", [-3, 9], 0)).toEqual({ x: 0, z: 4, rot: 0 });
    expect(snapPlacement("table_lamp", [2.6, 2.6], 0)).toEqual({ x: 2.25, z: 2.25, rot: 0 });
  });

  it("turns wall pieces to the nearest wall", () => {
    expect(needsWall("painting") && needsWall("bed") && !needsWall("wooden_chair")).toBe(true);
    expect(snapPlacement("painting", [0.2, 2.2], 0)).toEqual({ x: 0, z: 1.5, rot: 90 });
    expect(snapPlacement("bed", [3, 4.6], 0)).toEqual({ x: 2.5, z: 3, rot: 180 });
    expect(snapPlacement("wardrobe", [5.9, 1], 0)).toEqual({ x: 5.5, z: 0.5, rot: 270 });
  });

  it("picks the piece under a point, table-top pieces first and rugs last", () => {
    expect(furnitureAt(D, [2.5, 2.5])).toBe(lamp);
    expect(furnitureAt(D, [2.1, 2.9])).toBe(table);
    expect(furnitureAt(D, [1.7, 1.7])).toBe(indexOf("round_rug"));
    expect(furnitureAt(D, [4, 3])).toBeNull();
  });

  it("builds the walkability grid from the layout", () => {
    const grid = apartmentNavGrid(D);
    expect(isWalkable(grid, [5.5, 1])).toBe(false); // the bed
    expect(isWalkable(grid, [1.7, 1.7])).toBe(true); // the rug
    expect(isWalkable(openApartmentNavGrid(), [5.5, 1])).toBe(true);
    const stored = applied({ op: "store", index: indexOf("bed"), itemId: "bed" });
    expect(isWalkable(apartmentNavGrid(stored), [5.5, 1])).toBe(true);
  });
});
