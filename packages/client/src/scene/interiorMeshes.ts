import { type BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  INTERIOR_FURNITURE,
  type InteriorLayout,
  interiorWallPanels,
  pieceBackWall,
  piecePivot,
  type QuarterTurn,
  type RoomSide,
} from "@hellovalley/shared";
import { placementMatrix } from "./buildingMeshes";
import type { DrawItem } from "./drawCalls";
import type { KitMaterialKind, LoadedKit } from "./kitLoader";

/**
 * Render-ready geometry of an interior (build plan M13): the floor tiles and furniture merged into
 * one mesh per material slot, and each wall side merged on its own (per slot), so the cut-away
 * can lower the walls facing the camera by scaling their group. Wall-mounted pieces (mirrors,
 * paintings) go in their wall's `decor:` group, which the cut-away hides.
 */

export type InteriorGroup = "room" | RoomSide | `decor:${RoomSide}`;

export interface InteriorMeshPart {
  group: InteriorGroup;
  kind: KitMaterialKind;
  geometry: BufferGeometry;
}

export interface InteriorMeshes {
  layout: InteriorLayout;
  parts: InteriorMeshPart[];
  triangles: number;
}

interface Placed {
  group: InteriorGroup;
  module: string;
  variant: number;
  position: [number, number, number];
  rot: QuarterTurn;
  scale: [number, number, number];
}

/** Every module instance of a room. */
export function interiorPlacements(layout: InteriorLayout): Placed[] {
  const out: Placed[] = [];
  for (let j = 0; j < layout.d; j++) {
    for (let i = 0; i < layout.w; i++) {
      out.push({ group: "room", module: layout.floor.module, variant: layout.floor.variant, position: [i, 0, j + 1], rot: 0, scale: [1, 1, 1] });
    }
  }
  for (const p of layout.furniture) {
    const [x, z] = piecePivot(p);
    const wall = INTERIOR_FURNITURE[p.module].mount === "wall" ? pieceBackWall(layout, p) : null;
    const group: InteriorGroup = wall ? `decor:${wall}` : "room";
    out.push({ group, module: p.module, variant: p.variant, position: [x, p.y ?? 0, z], rot: p.rot, scale: [1, 1, 1] });
  }
  for (const w of interiorWallPanels(layout)) {
    out.push({ group: w.side, module: w.module, variant: w.variant, position: w.position, rot: w.rot, scale: w.scale });
  }
  return out;
}

export async function buildInteriorMeshes(layout: InteriorLayout, kit: LoadedKit): Promise<InteriorMeshes> {
  const placed = await Promise.all(interiorPlacements(layout).map(async (p) => ({ p, parts: await kit.variantParts(p.module, p.variant) })));
  const buckets = new Map<string, { group: InteriorGroup; kind: KitMaterialKind; list: BufferGeometry[] }>();
  const matrix = new Matrix4();
  for (const { p, parts } of placed) {
    placementMatrix(p, matrix);
    for (const part of parts) {
      const key = `${p.group}:${part.kind}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { group: p.group, kind: part.kind, list: [] }));
      b.list.push(part.geometry.clone().applyMatrix4(matrix));
    }
  }
  const parts: InteriorMeshPart[] = [];
  let triangles = 0;
  for (const { group, kind, list } of buckets.values()) {
    const geometry = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!geometry) throw new Error(`${layout.id}: could not merge the ${group} ${kind} meshes`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    triangles += (geometry.index?.count ?? 0) / 3;
    parts.push({ group, kind, geometry });
  }
  return { layout, parts, triangles };
}

export function disposeInteriorMeshes(meshes: InteriorMeshes): void {
  for (const p of meshes.parts) p.geometry.dispose();
}

/** Every mesh an interior scene draws (keep in step with scene/Interior.tsx). */
export function interiorDrawItems(meshes: InteriorMeshes): DrawItem[] {
  return [
    ...meshes.parts.map((p) => ({ label: `${p.group}:${p.kind}`, castShadow: true })),
    { label: "interior base", castShadow: false },
  ];
}
