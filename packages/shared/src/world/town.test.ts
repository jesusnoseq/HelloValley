/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type KitManifest, parseKitManifest } from "../assets/kit";
import { assembleBuilding } from "../buildings/assemble";
import { buildingRecipe } from "../buildings/recipes";
import { BUILDING_RECIPE_IDS } from "../buildings/schema";
import { FORAGE_ZONES } from "../data/forage";
import { PLACE_IDS } from "../data/world";
import { findPath, segmentWalkable } from "./astar";
import { buildTownNavGrid, cellOf, isWalkable, NAV_CELL_M, townBlockers, townDecks, townNavGrid } from "./navgrid";
import { type Rect, TOWN_PROPS, type TownPropModuleId } from "./props";
import { townRenderPlan } from "./render";
import {
  CORNER_BL,
  CORNER_BR,
  CORNER_FL,
  CORNER_FR,
  fitPiece,
  groundAt,
  type GroundMap,
  groundIndex,
  tileTerrain,
} from "./terrain";
import {
  type Area,
  buildingArea,
  buildingDoors,
  difficultySigns,
  FORAGE_ZONE_AREAS,
  rectToTown,
  SPAWN_POINT,
  SPAWN_POINTS,
  TOWN_BUILDINGS,
  TOWN_D,
  TOWN_PROPS_LAYOUT,
  TOWN_W,
  townDoors,
  townGround,
  townPlaces,
  type Vec2,
} from "./town";

const manifest = (kit: string): KitManifest =>
  parseKitManifest(JSON.parse(readFileSync(new URL(`../../../client/public/assets/kits/${kit}/kit-manifest.json`, import.meta.url), "utf8")));
// The committed europe kit (M05) stands in for every style kit: they share ids, footprints and sockets.
const europe = manifest("european");
const common = manifest("common");
const kitOf = (kit: "style" | "common") => (kit === "common" ? common : europe);
const moduleOf = (kit: KitManifest, id: string) => {
  const m = kit.modules.find((x) => x.id === id);
  if (!m) throw new Error(`${kit.style} has no ${id}`);
  return m;
};

const overlaps = (a: Area, b: Area) => a[0] < b[2] - 1e-9 && b[0] < a[2] - 1e-9 && a[1] < b[3] - 1e-9 && b[1] < a[3] - 1e-9;
const contains = (outer: Area, inner: Area) => inner[0] >= outer[0] - 1e-9 && inner[1] >= outer[1] - 1e-9 && inner[2] <= outer[2] + 1e-9 && inner[3] <= outer[3] + 1e-9;

function mapOf(rows: string[]): GroundMap {
  const key: Record<string, number> = { ".": groundIndex("grass"), p: groundIndex("path"), c: groundIndex("cobble"), "~": groundIndex("water") };
  const w = rows[0]!.length;
  const cells = new Uint8Array(w * rows.length);
  rows.forEach((row, z) => [...row].forEach((ch, x) => (cells[z * w + x] = key[ch]!)));
  return { w, d: rows.length, cells };
}

const ground = townGround();
const grid = townNavGrid();

describe("terrain tiling", () => {
  it("has a piece for every corner mask except the empty and the two diagonal ones", () => {
    for (let mask = 0; mask < 16; mask++) {
      const fit = fitPiece(mask);
      if (mask === 0 || mask === (CORNER_FL | CORNER_BR) || mask === (CORNER_FR | CORNER_BL)) expect(fit).toBeUndefined();
      else expect(fit, `mask ${mask}`).toBeDefined();
    }
    expect(fitPiece(CORNER_FL | CORNER_FR)).toMatchObject({ piece: "edge", rot: 0 });
    expect(fitPiece(CORNER_BL | CORNER_BR)).toMatchObject({ piece: "edge", rot: 2 });
    // Feature on the west half: the edge piece's front turned to face -x (three quarter turns).
    expect(fitPiece(CORNER_FL | CORNER_BL)).toMatchObject({ piece: "edge", rot: 3 });
    expect(fitPiece(CORNER_BR)).toMatchObject({ piece: "outer", rot: 2 });
    expect(fitPiece(15)).toMatchObject({ piece: "full", rot: 0 });
    expect(fitPiece(15 & ~CORNER_FL)).toMatchObject({ piece: "inner" });
  });

  it("tiles a path patch with flat interiors and edge pieces on the dual grid", () => {
    const { tiles, issues } = tileTerrain(mapOf(["....", ".pp.", ".pp.", "...."]));
    expect(issues).toEqual([]);
    expect(tiles).toHaveLength(9);
    const at = (x: number, z: number) => tiles.find((t) => t.x === x && t.z === z)!;
    expect(at(1.5, 1.5)).toEqual({ kind: "flat", ground: "path", x: 1.5, z: 1.5 });
    expect(at(0.5, 0.5)).toMatchObject({ kind: "piece", module: "terrain.path.outer", piece: "outer" });
    expect(at(1.5, 0.5)).toMatchObject({ kind: "piece", module: "terrain.path.edge", rot: 0, pivot: [1.5, 1.5] });
    expect(at(1.5, 2.5)).toMatchObject({ kind: "piece", module: "terrain.path.edge", rot: 2 });
  });

  it("reports diagonal corners and two features in one tile", () => {
    expect(tileTerrain(mapOf(["p.", ".p"])).issues).toEqual([{ x: 0.5, z: 0.5, reason: "diagonal" }]);
    expect(tileTerrain(mapOf(["pc", "pc"])).issues).toEqual([{ x: 0.5, z: 0.5, reason: "mixed" }]);
    expect(tileTerrain(mapOf(["~~", ".."])).tiles[0]).toMatchObject({ module: "bank.straight", rot: 2 });
  });

  it("renders the whole town ground with kit pieces (no diagonal or mixed tiles)", () => {
    const { tiles, issues } = tileTerrain(ground);
    expect(issues).toEqual([]);
    expect(tiles).toHaveLength((TOWN_W - 1) * (TOWN_D - 1));
  });
});

describe("town layout", () => {
  it("places all ten buildings on land, inside the town and apart", () => {
    expect(TOWN_BUILDINGS.map((b) => b.id).sort()).toEqual([...BUILDING_RECIPE_IDS].sort());
    const areas = TOWN_BUILDINGS.map(buildingArea);
    areas.forEach((a, i) => {
      expect(contains([1, 1, TOWN_W - 1, TOWN_D - 1], a), TOWN_BUILDINGS[i]!.id).toBe(true);
      for (let z = a[1]; z < a[3]; z++) for (let x = a[0]; x < a[2]; x++) expect(groundAt(ground, x + 0.5, z + 0.5)).not.toBe("water");
      for (let j = i + 1; j < areas.length; j++) expect(overlaps(a, areas[j]!), `${TOWN_BUILDINGS[i]!.id} / ${TOWN_BUILDINGS[j]!.id}`).toBe(false);
    });
  });

  it("follows the difficulty road from the apartment block (south) to the hill (north)", () => {
    const leaves: Record<string, number> = Object.fromEntries(TOWN_BUILDINGS.map((b) => [b.id, b.leaves]));
    expect(leaves).toEqual({
      apartment_block: 0,
      bakery: 1,
      farm: 1,
      general_store: 2,
      clinic: 2,
      cafe: 3,
      gossip_house: 3,
      town_hall: 4,
      library: 5,
      elder_cottage: 5,
    });
    const northOf = (id: string) => buildingArea(TOWN_BUILDINGS.find((b) => b.id === id)!)[1];
    const ring = (n: number) => TOWN_BUILDINGS.filter((b) => b.leaves === n).map((b) => northOf(b.id));
    for (let n = 1; n < 5; n++) expect(Math.max(...ring(n + 1))).toBeLessThan(Math.min(...ring(n)));
    expect(Math.min(...ring(1))).toBeLessThan(northOf("apartment_block"));
    // Walking distance grows ring by ring as well.
    const walk = (n: number) => {
      const lengths = TOWN_BUILDINGS.filter((b) => b.leaves === n).map((b) => pathLength(findPath(grid, SPAWN_POINT, buildingDoors(b)[0]!.approach)!));
      return lengths.reduce((a, b) => a + b, 0) / lengths.length;
    };
    for (let n = 1; n < 5; n++) expect(walk(n + 1)).toBeGreaterThan(walk(n));
  });

  it("puts one difficulty sign by each ranked building, clear of buildings and on land", () => {
    const signs = difficultySigns();
    expect(signs.map((s) => s.building).sort()).toEqual(TOWN_BUILDINGS.filter((b) => b.leaves > 0).map((b) => b.id).sort());
    const others = townBlockers().filter((b) => b.kind !== "sign");
    for (const s of signs) {
      const blocker = townBlockers().find((b) => b.kind === "sign" && b.source === s.building)!;
      for (const o of others) expect(overlaps(blocker.area, o.area), `${s.building} sign vs ${o.source}`).toBe(false);
      expect(groundAt(ground, ...s.position)).not.toBe("water");
    }
  });

  it("crosses the river with the bridge and reaches into it with the dock", () => {
    // The river spans the map from west to east.
    for (let x = 0; x < TOWN_W; x++) {
      let water = false;
      for (let z = 0; z < TOWN_D; z++) water ||= groundAt(ground, x + 0.5, z + 0.5) === "water";
      expect(water, `column ${x}`).toBe(true);
    }
    const bridge = TOWN_PROPS_LAYOUT.find((p) => p.module === "bridge.stone")!;
    const dock = TOWN_PROPS_LAYOUT.find((p) => p.module === "dock.fishing")!;
    const land = (p: Vec2) => groundAt(ground, ...p) !== "water";
    const b = moduleOf(common, "bridge.stone");
    const socket = (m: typeof b, name: string): Vec2 => {
      const s = m.sockets.find((x) => x.name === name)!;
      return [s.pos[0], s.pos[2]];
    };
    const at = (p: typeof bridge, local: Vec2): Vec2 => rectToTown(p, [local[0], local[1], local[0], local[1]]).slice(0, 2) as Vec2;
    expect(land(at(bridge, socket(b, "front")))).toBe(true);
    expect(land(at(bridge, socket(b, "back")))).toBe(true);
    expect(land(at(bridge, socket(b, "crown")))).toBe(false);
    const d = moduleOf(common, "dock.fishing");
    expect(land(at(dock, socket(d, "land")))).toBe(true);
    expect(land(at(dock, socket(d, "fish")))).toBe(false);
  });

  it("keeps every prop inside the town, off the buildings and out of the water (except the river pieces)", () => {
    const areas = TOWN_BUILDINGS.map(buildingArea);
    for (const p of TOWN_PROPS_LAYOUT) {
      const def = TOWN_PROPS[p.module];
      const area = rectToTown(p, [0, -def.d, def.w, 0]);
      expect(contains([0.5, 0.5, TOWN_W - 0.5, TOWN_D - 0.5], area), p.module).toBe(true);
      for (const a of areas) expect(overlaps(a, area), `${p.module} at ${p.at}`).toBe(false);
      if (p.module === "bridge.stone" || p.module === "dock.fishing") continue;
      const [cx, cz] = [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2];
      expect(groundAt(ground, cx, cz), `${p.module} at ${p.at}`).not.toBe("water");
    }
  });

  it("names a standing point for every place, and has forage zones inside the town", () => {
    const places = townPlaces();
    expect(Object.keys(places).sort()).toEqual([...PLACE_IDS].sort());
    for (const zone of FORAGE_ZONES) {
      expect(FORAGE_ZONE_AREAS[zone].length).toBeGreaterThan(0);
      for (const a of FORAGE_ZONE_AREAS[zone]) expect(contains([0, 0, TOWN_W, TOWN_D], a)).toBe(true);
    }
  });
});

describe("town doors", () => {
  it("match the assembler's door sockets", () => {
    for (const b of TOWN_BUILDINGS) {
      const assembled = assembleBuilding(buildingRecipe(b.id), europe);
      const fromKit = assembled.doors.map((d) => rectToTown(b, [d.position[0], d.position[2], d.position[0], d.position[2]]).slice(0, 2));
      expect(buildingDoors(b).map((d) => d.position)).toEqual(fromKit);
      for (const d of buildingDoors(b)) {
        const local = assembled.doors[0]!.normal;
        const turned = rectToTown({ at: [0, 0], rot: b.rot }, [local[0], local[2], local[0], local[2]]).slice(0, 2);
        expect(d.normal.map((v) => Math.round(v) + 0)).toEqual(turned.map((v) => Math.round(v) + 0));
      }
    }
  });
});

function pathLength(path: Vec2[]): number {
  let total = 0;
  for (let k = 1; k < path.length; k++) total += Math.hypot(path[k]![0] - path[k - 1]![0], path[k]![1] - path[k - 1]![1]);
  return total;
}

describe("walkability grid", () => {
  it("is 0.5 m cells over the whole town", () => {
    expect(grid.cell).toBe(NAV_CELL_M);
    expect([grid.w, grid.d]).toEqual([TOWN_W * 2, TOWN_D * 2]);
    expect(buildTownNavGrid().walk).toEqual(grid.walk);
  });

  it("blocks water, buildings and the diorama border but not the bridge and dock decks", () => {
    for (let j = 0; j < grid.d; j++) {
      for (let i = 0; i < grid.w; i++) {
        const c: Vec2 = [(i + 0.5) * grid.cell, (j + 0.5) * grid.cell];
        const onDeck = townDecks().some((d) => contains(d, [c[0], c[1], c[0], c[1]]));
        if (groundAt(ground, ...c) === "water" && !onDeck) expect(isWalkable(grid, c)).toBe(false);
        if (c[0] < 1 || c[1] < 1 || c[0] > TOWN_W - 1 || c[1] > TOWN_D - 1) expect(isWalkable(grid, c)).toBe(false);
      }
    }
    for (const b of TOWN_BUILDINGS) {
      const a = buildingArea(b);
      expect(isWalkable(grid, [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2])).toBe(false);
    }
    expect(isWalkable(grid, townPlaces().bridge)).toBe(true);
    expect(isWalkable(grid, townPlaces().fishing_dock)).toBe(true);
  });

  it("puts every spawn point on walkable ground", () => {
    for (const p of SPAWN_POINTS) expect(isWalkable(grid, p), `${p}`).toBe(true);
    const cells = new Set(SPAWN_POINTS.map((p) => cellOf(grid, p).join(",")));
    expect(cells.size).toBe(SPAWN_POINTS.length);
  });

  it("reaches every door from the spawn point with A*", () => {
    const doors = townDoors();
    expect(new Set(doors.map((d) => d.building)).size).toBe(BUILDING_RECIPE_IDS.length);
    for (const door of doors) {
      expect(isWalkable(grid, door.approach), `${door.building} door`).toBe(true);
      const path = findPath(grid, SPAWN_POINT, door.approach);
      expect(path, `path to ${door.building}`).not.toBeNull();
      expect(path![0]).toEqual(SPAWN_POINT);
      expect(path!.at(-1)).toEqual(door.approach);
      for (let k = 1; k < path!.length; k++) expect(segmentWalkable(grid, path![k - 1]!, path![k]!)).toBe(true);
    }
  });

  it("reaches every place from the spawn point", () => {
    for (const [id, p] of Object.entries(townPlaces())) expect(findPath(grid, SPAWN_POINT, p), id).not.toBeNull();
  });

  it("can only reach the hill over the bridge", () => {
    const library = townPlaces().library;
    const path = findPath(grid, SPAWN_POINT, library)!;
    const deck = townDecks()[0]!;
    // Some waypoint, or a segment, lies on the bridge deck.
    const onBridge = path.some((p, k) => {
      if (contains(deck, [p[0], p[1], p[0], p[1]])) return true;
      const q = path[k + 1];
      if (!q) return false;
      const zMid = (deck[1] + deck[3]) / 2;
      if ((p[1] - zMid) * (q[1] - zMid) > 0) return false;
      const x = p[0] + ((zMid - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
      return x >= deck[0] && x <= deck[2];
    });
    expect(onBridge).toBe(true);
  });
});

describe("town props", () => {
  it("uses modules that exist in their kits, with blockers covering solid props", () => {
    for (const [id, def] of Object.entries(TOWN_PROPS) as [TownPropModuleId, (typeof TOWN_PROPS)[TownPropModuleId]][]) {
      const m = moduleOf(kitOf(def.kit), id);
      expect([m.footprint.w, m.footprint.d], id).toEqual([def.w, def.d]);
      const blocks = (def as { blocks?: Rect }).blocks;
      if (blocks) expect(contains([0, -def.d, def.w, 0], blocks), id).toBe(true);
      if ((def as { solid?: boolean }).solid) {
        expect(contains(blocks!, [m.bounds.min[0], m.bounds.min[2], m.bounds.max[0], m.bounds.max[2]]), `${id} blocker vs bounds`).toBe(true);
      }
      const walk = (def as { walk?: Rect }).walk;
      if (walk) expect(m.tags).toContain("walkable");
    }
  });
});

describe("render plan", () => {
  const plan = townRenderPlan();

  it("only uses modules and variants the kits have", () => {
    for (const m of plan.modules) {
      const mod = moduleOf(kitOf(m.kit), m.module);
      expect(m.variant).toBeLessThan(mod.variants);
      expect(m.variant).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers every visible tile once (tiles under buildings are skipped)", () => {
    const terrain = plan.modules.filter((m) => m.module.startsWith("terrain.") || m.module.startsWith("bank."));
    const visible = plan.flats.length + terrain.length;
    expect(visible).toBeLessThanOrEqual((TOWN_W - 1) * (TOWN_D - 1));
    expect(visible).toBeGreaterThan((TOWN_W - 1) * (TOWN_D - 1) - 300);
  });

  it("keeps the whole town, buildings included, under the GDD budget of 300k triangles", () => {
    let triangles = 0;
    for (const m of plan.modules) triangles += moduleOf(kitOf(m.kit), m.module).tris[m.variant]!;
    triangles += plan.flats.reduce((n, f) => n + (f.ground === "water" ? 4 : 2), 0);
    for (const b of TOWN_BUILDINGS) {
      for (const p of assembleBuilding(buildingRecipe(b.id), europe).placements) triangles += moduleOf(europe, p.module).tris[p.variant]!;
    }
    expect(triangles).toBeLessThan(300_000);
  });
});
