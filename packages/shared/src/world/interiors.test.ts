import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KIT_INTERIOR_MODULE_IDS } from "../assets/budgets";
import { parseKitManifest } from "../assets/kit";
import { BUILDING_RECIPE_IDS } from "../buildings/schema";
import {
  buildingForInterior,
  INTERIOR_FURNITURE,
  INTERIOR_IDS,
  INTERIOR_LAYOUTS,
  INTERIOR_WALL_T,
  interiorEntrance,
  interiorForBuilding,
  interiorNavGrid,
  interiorProblems,
  interiorWallPanels,
  pieceArea,
  piecePivot,
  ROOM_SIDES,
  sideLength,
} from "./interiors";
import { circleFits, planPath } from "./movement";
import { rectToTown } from "./town";

const manifest = parseKitManifest(
  JSON.parse(readFileSync(new URL("../../../client/public/assets/kits/interior/kit-manifest.json", import.meta.url), "utf8")),
);
const byId = new Map(manifest.modules.map((m) => [m.id, m]));

/** Upper bound on one interior's triangles (the town is 300k; a room is shown instead of it). */
const INTERIOR_TRI_BUDGET = 60_000;

describe("interior layouts", () => {
  it("has one interior per town building, the apartment block leading to the apartment", () => {
    expect(BUILDING_RECIPE_IDS.map(interiorForBuilding).sort()).toEqual([...INTERIOR_IDS].sort());
    expect(interiorForBuilding("apartment_block")).toBe("apartment");
    for (const id of INTERIOR_IDS) {
      expect(interiorForBuilding(buildingForInterior(id))).toBe(id);
      expect(INTERIOR_LAYOUTS[id].id).toBe(id);
    }
  });

  it("mirrors the furniture placement footprints of the interior kit manifest", () => {
    for (const [id, f] of Object.entries(INTERIOR_FURNITURE)) {
      const m = byId.get(id);
      expect(m?.placement, id).toBeDefined();
      expect({ w: m!.placement!.w, d: m!.placement!.d, mount: m!.placement!.mount, againstWall: m!.placement!.againstWall }, id).toEqual(f);
    }
    const furniture = manifest.modules.filter((m) => m.placement).map((m) => m.id);
    expect(Object.keys(INTERIOR_FURNITURE).sort()).toEqual(furniture.sort());
    for (const id of KIT_INTERIOR_MODULE_IDS) expect(byId.has(id), id).toBe(true);
  });

  it.each(INTERIOR_IDS)("%s follows the layout rules", (id) => {
    expect(interiorProblems(INTERIOR_LAYOUTS[id])).toEqual([]);
  });

  it("catches broken layouts", () => {
    const base = INTERIOR_LAYOUTS.bakery;
    const broken = {
      ...base,
      windows: [...base.windows, { side: "south" as const, slot: base.door.slot }],
      furniture: [
        ...base.furniture,
        { module: "bed" as const, variant: 0, at: [2.5, 2.5] as [number, number], rot: 0 as const },
        { module: "chair" as const, variant: 0, at: [5.75, 0] as [number, number], rot: 0 as const },
        { module: "chair" as const, variant: 0, at: [5.5, 4.5] as [number, number], rot: 0 as const },
      ],
    };
    const problems = interiorProblems(broken).join("\n");
    expect(problems).toMatch(/two openings/);
    expect(problems).toMatch(/bed#\d+: its back must be on a wall/);
    expect(problems).toMatch(/chair#\d+: not on the 0.5 m grid/);
    expect(problems).toMatch(/overlaps/);
  });

  it("puts each piece's pivot so the turned module footprint covers its area", () => {
    for (const layout of Object.values(INTERIOR_LAYOUTS)) {
      for (const p of layout.furniture) {
        const f = INTERIOR_FURNITURE[p.module];
        const area = rectToTown({ at: piecePivot(p), rot: p.rot }, [0, -f.d * 0.5, f.w * 0.5, 0]);
        pieceArea(p).forEach((v, k) => expect(area[k]).toBeCloseTo(v, 9));
      }
    }
  });

  it("lines every room with wall panels just outside the floor, closed at the corners", () => {
    const t = INTERIOR_WALL_T;
    for (const layout of Object.values(INTERIOR_LAYOUTS)) {
      const panels = interiorWallPanels(layout);
      for (const side of ROOM_SIDES) expect(panels.filter((p) => p.side === side).length).toBe(sideLength(layout, side));
      expect(panels.filter((p) => p.module === "iwall.door")).toHaveLength(1);
      expect(panels.filter((p) => p.module === "iwall.window")).toHaveLength(layout.windows.length);
      for (const side of ROOM_SIDES) {
        // The 0.1 m slab of each panel (module frame z in [-1, -0.9], scaled along x).
        const slabs = panels
          .filter((p) => p.side === side)
          .map((p) => rectToTown({ at: [p.position[0], p.position[2]], rot: p.rot }, [0, -1, p.scale[0], -0.9]));
        const { w, d } = layout;
        const expected = { north: [-t, -t, w + t, 0], south: [-t, d, w + t, d + t], west: [-t, 0, 0, d], east: [w, 0, w + t, d] }[side];
        const union = [Math.min(...slabs.map((s) => s[0])), Math.min(...slabs.map((s) => s[1])), Math.max(...slabs.map((s) => s[2])), Math.max(...slabs.map((s) => s[3]))];
        union.forEach((v, k) => expect(v, `${layout.id} ${side}`).toBeCloseTo(expected[k]!, 9));
        const along = side === "north" || side === "south" ? 0 : 1;
        const total = slabs.reduce((n, s) => n + s[along + 2]! - s[along]!, 0);
        expect(total).toBeCloseTo(union[along + 2]! - union[along]!, 9);
      }
    }
  });

  it.each(INTERIOR_IDS)("%s: every spot is reachable from the entrance", (id) => {
    const layout = INTERIOR_LAYOUTS[id];
    const grid = interiorNavGrid(id);
    const { arrival, trigger } = interiorEntrance(layout);
    expect(circleFits(grid, arrival)).toBe(true);
    const doorMid: [number, number] = [(trigger[0] + trigger[2]) / 2, (trigger[1] + trigger[3]) / 2];
    expect(circleFits(grid, doorMid)).toBe(true);
    for (const [name, spot] of Object.entries(layout.spots)) {
      if (name === "vendor") continue; // behind the counter, inside its placement footprint
      expect(circleFits(grid, spot), `${id}.${name}`).toBe(true);
      const path = planPath(grid, arrival, spot);
      expect(path, `${id}.${name}`).not.toBeNull();
      expect(path!.at(-1), `${id}.${name}`).toEqual(spot);
    }
  });

  it.each(INTERIOR_IDS)("%s stays within the triangle budget", (id) => {
    const layout = INTERIOR_LAYOUTS[id];
    const tris = (module: string, variant: number) => {
      const m = byId.get(module)!;
      return m.tris[variant % m.variants]!;
    };
    let total = layout.w * layout.d * tris(layout.floor.module, layout.floor.variant);
    for (const p of interiorWallPanels(layout)) total += tris(p.module, p.variant);
    for (const p of layout.furniture) total += tris(p.module, p.variant);
    expect(total).toBeLessThan(INTERIOR_TRI_BUDGET);
  });
});
