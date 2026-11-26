/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIT_BUILDING_MODULE_IDS } from "../assets/budgets";
import { type KitManifest, parseKitManifest } from "../assets/kit";
import { assembleBuilding, type ModulePlacement, rotateVec, transformPoint } from "./assemble";
import {
  ATTACHMENT_FITS,
  ATTACHMENT_MODULE_IDS,
  BUILDING_PROP_MODULE_IDS,
  RECIPE_MODULE_IDS,
  ROOF_MODULE_IDS,
  ROOFS_WITH_DORMERS,
} from "./modules";
import { BUILDING_RECIPE_FILES, buildingRecipes } from "./recipes";
import {
  BUILDING_RECIPE_IDS,
  type BuildingRecipe,
  BuildingRecipeSchema,
  facadeRow,
  FACADE_SIDES,
  PROP_FOOTPRINTS,
  rotateXZ,
  sideSlotCount,
} from "./schema";

// The committed europe kit (M05) is the reference kit: every recipe must render with it.
const europe: KitManifest = parseKitManifest(
  JSON.parse(readFileSync(new URL("../../../client/public/assets/kits/european/kit-manifest.json", import.meta.url), "utf8")),
);
const europeIds = new Set(europe.modules.map((m) => m.id));
const moduleOf = (id: string) => {
  const m = europe.modules.find((x) => x.id === id);
  if (!m) throw new Error(`no ${id}`);
  return m;
};

const recipes = Object.values(buildingRecipes());

// The Mediterranean (M32) and Arabic (M33) kits reuse every building module id, footprint and
// socket.
const styleKit = (style: string): KitManifest =>
  parseKitManifest(JSON.parse(readFileSync(new URL(`../../../client/public/assets/kits/${style}/kit-manifest.json`, import.meta.url), "utf8")));
const STYLE_KITS = { mediterranean: styleKit("mediterranean"), arabic: styleKit("arabic") };
const styleCases = Object.entries(STYLE_KITS).flatMap(([style, kit]) => recipes.map((r) => [r.id, style, r, kit] as const));

/** Every module id a recipe names, directly or through what the assembler adds. */
function referencedIds(recipe: BuildingRecipe): Set<string> {
  const ids = new Set<string>(["corner.outer", recipe.walls.default, recipe.roof.module]);
  for (const side of FACADE_SIDES) for (const row of recipe.walls[side] ?? []) row.forEach((m) => ids.add(m));
  if (recipe.roof.chimney) ids.add("chimney");
  if (recipe.roof.dormers > 0) ids.add("dormer");
  recipe.attachments.forEach((a) => ids.add(a.module));
  recipe.props.forEach((p) => ids.add(p.module));
  return ids;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

describe("building recipes", () => {
  it("has the 10 M10 buildings, each file named after its id", () => {
    expect(Object.keys(BUILDING_RECIPE_FILES).sort()).toEqual([...BUILDING_RECIPE_IDS].sort());
    expect(recipes.map((r) => r.id).sort()).toEqual([...BUILDING_RECIPE_IDS].sort());
  });

  it.each(BUILDING_RECIPE_IDS.map((id) => [id]))("%s validates", (id) => {
    const result = BuildingRecipeSchema.safeParse(BUILDING_RECIPE_FILES[id]);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it.each(recipes.map((r) => [r.id, r] as const))("%s only uses modules of the europe kit", (_id, recipe) => {
    for (const id of referencedIds(recipe)) {
      expect(RECIPE_MODULE_IDS).toContain(id);
      expect(europeIds.has(id), id).toBe(true);
    }
    for (const p of assembleBuilding(recipe, europe).placements) expect(europeIds.has(p.module), p.module).toBe(true);
  });

  it.each(styleCases)("%s assembles with the %s kit exactly as with the europe kit", (_id, _style, recipe, kit) => {
    const kitIds = new Set(kit.modules.map((m) => m.id));
    for (const id of referencedIds(recipe)) expect(kitIds.has(id), id).toBe(true);
    const a = assembleBuilding(recipe, europe);
    const b = assembleBuilding(recipe, kit);
    expect(b.placements).toEqual(a.placements);
    expect(b.doors).toEqual(a.doors);
    expect(b.eaveHeight).toBe(a.eaveHeight);
  });

  it.each(Object.entries(STYLE_KITS))("the %s kit mirrors every building module of the europe kit", (_style, kit) => {
    for (const id of KIT_BUILDING_MODULE_IDS) {
      const eu = moduleOf(id);
      const other = kit.modules.find((m) => m.id === id);
      expect(other, id).toBeDefined();
      expect(other!.footprint, id).toEqual(eu.footprint);
      expect(other!.sockets, id).toEqual(eu.sockets);
      expect(other!.variants, id).toBe(eu.variants);
      expect(other!.tags.filter((t) => t.startsWith("fits:")), id).toEqual(eu.tags.filter((t) => t.startsWith("fits:")));
    }
  });

  it("the apartment block has 5 floors with balconies", () => {
    const apartment = buildingRecipes().apartment_block;
    expect(apartment.floors).toBe(5);
    expect(apartment.attachments.filter((a) => a.module === "balcony").length).toBeGreaterThanOrEqual(4);
  });

  it("every recipe id is a building module every style kit must provide", () => {
    for (const id of RECIPE_MODULE_IDS) expect(KIT_BUILDING_MODULE_IDS as readonly string[]).toContain(id);
  });
});

describe("module tables match the europe manifest", () => {
  it("attachment fits", () => {
    for (const id of ATTACHMENT_MODULE_IDS) {
      const fits = moduleOf(id)
        .tags.filter((t) => t.startsWith("fits:"))
        .map((t) => t.slice(5));
      expect([...ATTACHMENT_FITS[id]].sort(), id).toEqual(fits.sort());
    }
  });

  it("prop footprints", () => {
    for (const id of BUILDING_PROP_MODULE_IDS) {
      const { w, d } = moduleOf(id).footprint;
      expect(PROP_FOOTPRINTS[id], id).toEqual({ w, d });
    }
  });

  it("roofs are 2 x 2 with dormer sockets where the table says", () => {
    for (const id of ROOF_MODULE_IDS) {
      const roof = moduleOf(id);
      expect(roof.footprint.w).toBe(2);
      expect(roof.footprint.d).toBe(2);
      expect(roof.sockets.some((s) => s.name === "dormer"), id).toBe(ROOFS_WITH_DORMERS.includes(id));
    }
  });
});

describe("quarter turns", () => {
  it("match three.js rotateY", () => {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const [x, z] = rotateXZ(0.3, -0.7, k);
      expect(x).toBeCloseTo(0.3 * Math.cos(a) + -0.7 * Math.sin(a));
      expect(z).toBeCloseTo(-0.3 * Math.sin(a) + -0.7 * Math.cos(a));
    }
    expect(rotateVec([0, 0, 1], 1)).toEqual([1, 0, -0]);
    expect(rotateXZ(1, 2, -1)).toEqual(rotateXZ(1, 2, 3));
  });
});

/** The footprint cells (x, z of the cell's front-left corner) a 1 x 1 placement covers. */
function cellOf(p: ModulePlacement): string {
  const corners = [
    [0, 0],
    [1, 0],
    [0, -1],
    [1, -1],
  ].map(([x, z]) => transformPoint(p, [x!, 0, z!]));
  const x = Math.min(...corners.map((c) => c[0]));
  const z = Math.max(...corners.map((c) => c[2]));
  return `${round(x)},${round(z)}`;
}

describe.each(recipes.map((r) => [r.id, r] as const))("assembled %s", (_id, recipe) => {
  const building = assembleBuilding(recipe, europe);
  const { w, d } = recipe.footprint;

  it("covers every perimeter cell exactly once per floor, facing out", () => {
    for (let floor = 0; floor < recipe.floors; floor++) {
      const shell = building.placements.filter((p) => (p.role === "wall" || p.role === "corner") && p.floor === floor);
      const cells = shell.map(cellOf);
      expect(new Set(cells).size).toBe(cells.length);
      expect(cells.length).toBe(2 * (w + d) - 4);
      for (const p of shell) {
        expect(p.position[1]).toBe(floor * 3);
        expect(p.scale).toEqual([1, 1, 1]);
        // The facade (local z = 0 plane, normal +Z) lies on the footprint edge and faces out.
        const n = rotateVec([0, 0, 1], p.rot);
        const mid = transformPoint(p, [0.5, 0, 0]);
        if (n[2] > 0.5) expect(round(mid[2])).toBe(0);
        if (n[2] < -0.5) expect(round(mid[2])).toBe(-d);
        if (n[0] > 0.5) expect(round(mid[0])).toBe(w);
        if (n[0] < -0.5) expect(round(mid[0])).toBe(0);
      }
      // Every slot of every side is the recipe's wall.
      for (const side of FACADE_SIDES) {
        const walls = shell.filter((p) => p.role === "wall" && p.side === side).map((p) => p.module);
        expect(walls).toEqual(facadeRow(recipe, side, floor));
        expect(walls.length).toBe(sideSlotCount(recipe.footprint, side));
      }
    }
  });

  it("puts the roof on the wall tops over the whole footprint", () => {
    const roof = building.placements.find((p) => p.role === "roof")!;
    expect(roof.module).toBe(recipe.roof.module);
    expect(roof.position[1]).toBe(recipe.floors * 3);
    const m = moduleOf(roof.module);
    const corners = [
      [0, 0, 0],
      [m.footprint.w, 0, 0],
      [0, 0, -m.footprint.d],
      [m.footprint.w, 0, -m.footprint.d],
    ].map((c) => transformPoint(roof, c));
    expect(Math.min(...corners.map((c) => round(c[0])))).toBe(0);
    expect(Math.max(...corners.map((c) => round(c[0])))).toBe(w);
    expect(Math.min(...corners.map((c) => round(c[2])))).toBe(-d);
    expect(Math.max(...corners.map((c) => round(c[2])))).toBe(0);
    // Height scales with the span across the ridge, so the pitch is unchanged.
    expect(roof.scale[1]).toBe(roof.scale[2]);
    expect(building.eaveHeight).toBe(recipe.floors * 3);
  });

  it("mates chimneys and dormers with the roof sockets", () => {
    const roof = building.placements.find((p) => p.role === "roof")!;
    const chimneys = building.placements.filter((p) => p.role === "chimney");
    expect(chimneys.length).toBe(recipe.roof.chimney ? 1 : 0);
    for (const c of chimneys) {
      const base = transformPoint(c, moduleOf("chimney").sockets.find((s) => s.name === "base")!.pos);
      const target = transformPoint(roof, moduleOf(roof.module).sockets.find((s) => s.name === "chimney")!.pos);
      base.forEach((v, i) => expect(v).toBeCloseTo(target[i]!));
    }
    const dormers = building.placements.filter((p) => p.role === "dormer");
    expect(dormers.length).toBe(recipe.roof.dormers);
    for (const p of dormers) {
      expect(p.position[1]).toBeGreaterThan(building.eaveHeight);
      expect(p.rot).toBe(roof.rot);
    }
  });

  it("hangs attachments in front of their walls", () => {
    for (const a of building.placements.filter((p) => p.role === "attachment")) {
      // The attachment's back plane centre (local z = -1) is its wall's facade centre (local z = 0).
      const back = transformPoint(a, [0.5, 0, -1]).map(round).join();
      const wall = building.placements.find(
        (p) => p.role === "wall" && p.rot === a.rot && transformPoint(p, [0.5, 0, 0]).map(round).join() === back,
      );
      expect(wall, `${a.module} on ${a.side}`).toBeDefined();
      expect(wall!.floor).toBe(a.floor);
      expect(ATTACHMENT_FITS[a.module as keyof typeof ATTACHMENT_FITS]).toContain(wall!.module);
    }
  });

  it("has its entrance on the front and keeps props outside the footprint", () => {
    const front = building.doors.filter((x) => x.side === "front");
    expect(front.length).toBeGreaterThan(0);
    for (const door of front) {
      expect(door.position[2]).toBeCloseTo(0);
      expect(door.position[0]).toBeGreaterThan(1);
      expect(door.position[0]).toBeLessThan(w - 1);
      expect(door.normal).toEqual([0, 0, 1]);
    }
    for (const p of building.placements.filter((x) => x.role === "prop")) {
      const m = moduleOf(p.module);
      const mid = transformPoint(p, [m.footprint.w / 2, 0, -m.footprint.d / 2]);
      const inside = mid[0] > 0 && mid[0] < w && mid[2] < 0 && mid[2] > -d;
      expect(inside, p.module).toBe(false);
    }
  });

  it("stays close to its footprint", () => {
    const shell = assembleBuilding({ ...recipe, props: [] }, europe).bounds;
    expect(shell.min[0]).toBeGreaterThan(-1.1);
    expect(shell.max[0]).toBeLessThan(w + 1.1);
    expect(shell.min[2]).toBeGreaterThan(-d - 1.1);
    expect(shell.max[2]).toBeLessThan(1.1);
    expect(shell.min[1]).toBeGreaterThanOrEqual(-0.5);
    expect(shell.max[1]).toBeGreaterThan(building.eaveHeight);
  });
});

describe("style independence", () => {
  it("wraps variants and keeps every placement when a kit has fewer variants", () => {
    const lean: KitManifest = { ...europe, style: "japanese", modules: europe.modules.map((m) => ({ ...m, variants: 1, tris: [m.tris[0]!] })) };
    for (const recipe of recipes) {
      const a = assembleBuilding(recipe, europe);
      const b = assembleBuilding(recipe, lean);
      expect(b.placements.map((p) => p.variant).every((v) => v === 0)).toBe(true);
      expect(b.placements.map(({ variant: _v, ...rest }) => rest)).toEqual(a.placements.map(({ variant: _v, ...rest }) => rest));
    }
  });

  it("names the missing module when a kit is incomplete", () => {
    const broken: KitManifest = { ...europe, modules: europe.modules.filter((m) => m.id !== "roof.hip") };
    expect(() => assembleBuilding(buildingRecipes().clinic, broken)).toThrow(/roof\.hip/);
  });
});

describe("recipe validation rejects", () => {
  const base = () => structuredClone(BUILDING_RECIPE_FILES.bakery) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const issues = (data: unknown) => BuildingRecipeSchema.safeParse(data).error?.issues.map((i) => i.message) ?? [];

  it("the shipped bakery as a baseline", () => {
    expect(issues(base())).toEqual([]);
  });

  it("rows that do not match the side length", () => {
    const r = base();
    r.walls.front[0] = ["wall.door"];
    expect(issues(r).join()).toMatch(/needs 2 slots/);
  });

  it("a front without a door", () => {
    const r = base();
    r.walls.front[0] = ["wall.shopfront", "wall.window"];
    r.attachments = [];
    expect(issues(r).join()).toMatch(/needs a wall.door/);
  });

  it("attachments that do not fit their wall or slot", () => {
    const r = base();
    r.attachments = [
      { module: "shutters", side: "front", floor: 0, slot: 1 },
      { module: "flowerbox", side: "left", floor: 0, slot: 3 },
      { module: "awning", side: "front", floor: 5, slot: 0 },
      { module: "flowerbox", side: "front", floor: 1, slot: 0, icon: "bread" },
    ];
    const msgs = issues(r).join("\n");
    expect(msgs).toMatch(/shutters does not fit wall.door/);
    expect(msgs).toMatch(/left has 1 slots/);
    expect(msgs).toMatch(/above the top floor/);
    expect(msgs).toMatch(/only sign.hanging carries an icon/);
  });

  it("a sign under an awning and duplicate attachments", () => {
    const r = base();
    r.attachments.push({ module: "awning", side: "front", floor: 0, slot: 1 }, { module: "awning", side: "front", floor: 0, slot: 0 });
    const msgs = issues(r).join("\n");
    expect(msgs).toMatch(/sign and awning share/);
    expect(msgs).toMatch(/duplicate awning/);
  });

  it("upper-floor shopfronts and doors without a balcony", () => {
    const r = base();
    r.walls.front[1] = ["wall.shopfront", "wall.door"];
    const msgs = issues(r).join("\n");
    expect(msgs).toMatch(/shopfronts belong on the ground floor/);
    expect(msgs).toMatch(/upper-floor door needs a balcony/);
  });

  it("dormers on a hip roof, too many dormers and more rows than floors", () => {
    const r = base();
    r.roof = { module: "roof.hip", ridge: "x", dormers: 1 };
    r.walls.front.push(["wall.window", "wall.window"]);
    const msgs = issues(r).join("\n");
    expect(msgs).toMatch(/roof.hip has no dormer slope/);
    expect(msgs).toMatch(/3 rows for 2 floors/);
    r.roof = { module: "roof.gable", ridge: "x", dormers: 3 };
    expect(issues(r).join()).toMatch(/3 dormers need/);
  });

  it("props inside the footprint, unknown modules and unknown keys", () => {
    const r = base();
    r.props = [{ module: "lamp", at: [1, -1] }];
    expect(issues(r).join()).toMatch(/inside the building footprint/);
    expect(issues({ ...base(), roof: { module: "roof.dome", ridge: "x" } }).length).toBeGreaterThan(0);
    expect(issues({ ...base(), colour: "red" }).length).toBeGreaterThan(0);
    expect(issues({ ...base(), footprint: { w: 2, d: 3 } }).length).toBeGreaterThan(0);
  });
});
