import { type BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type AssembledBuilding,
  assembleBuilding,
  type BuildingRecipe,
  type ModulePlacement,
  rotateVec,
  type SignIcon,
  transformPoint,
  type Vec3,
} from "@hellovalley/shared";
import type { KitMaterialKind, LoadedKit } from "./kitLoader";

/**
 * Turns an assembled recipe into render-ready geometry: every placed module variant, transformed
 * into the building frame and merged into one geometry per material slot (GDD §7.2 "merged by
 * material per building"), so a building costs at most one draw call per slot.
 */

export interface BuildingMeshPart {
  kind: KitMaterialKind;
  geometry: BufferGeometry;
}

export interface BuildingSign {
  icon: SignIcon;
  /** The sign board's icon socket and the direction it faces, in the building frame. */
  position: Vec3;
  normal: Vec3;
}

export interface BuildingMeshes {
  kitId: string;
  assembled: AssembledBuilding;
  parts: BuildingMeshPart[];
  signs: BuildingSign[];
  triangles: number;
}

const Y = new Vector3(0, 1, 0);

/** The three.js matrix of a placement: translate * rotateY(rot quarter turns) * scale. */
export function placementMatrix(p: Pick<ModulePlacement, "position" | "rot" | "scale">, target = new Matrix4()): Matrix4 {
  return target.compose(
    new Vector3(...p.position),
    new Quaternion().setFromAxisAngle(Y, (p.rot * Math.PI) / 2),
    new Vector3(...p.scale),
  );
}

export async function buildBuildingMeshes(recipe: BuildingRecipe, kit: LoadedKit): Promise<BuildingMeshes> {
  const assembled = assembleBuilding(recipe, kit.manifest);
  const placed = await Promise.all(
    assembled.placements.map(async (p) => ({ p, parts: await kit.variantParts(p.module, p.variant) })),
  );

  const buckets = new Map<KitMaterialKind, BufferGeometry[]>();
  const matrix = new Matrix4();
  for (const { p, parts } of placed) {
    placementMatrix(p, matrix);
    for (const part of parts) {
      const list = buckets.get(part.kind) ?? [];
      list.push(part.geometry.clone().applyMatrix4(matrix));
      buckets.set(part.kind, list);
    }
  }

  const parts: BuildingMeshPart[] = [];
  let triangles = 0;
  for (const [kind, list] of buckets) {
    const geometry = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!geometry) throw new Error(`${recipe.id}: could not merge the ${kind} meshes`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    triangles += (geometry.index?.count ?? 0) / 3;
    parts.push({ kind, geometry });
  }

  const signs: BuildingSign[] = [];
  for (const p of assembled.placements) {
    if (!p.icon) continue;
    for (const s of kit.module(p.module).sockets) {
      if (s.name !== "icon" && s.name !== "icon_back") continue;
      signs.push({ icon: p.icon, position: transformPoint(p, s.pos), normal: rotateVec(s.normal, p.rot) });
    }
  }

  return { kitId: kit.id, assembled, parts, signs, triangles };
}

export function disposeBuildingMeshes(meshes: BuildingMeshes): void {
  for (const part of meshes.parts) part.geometry.dispose();
}
