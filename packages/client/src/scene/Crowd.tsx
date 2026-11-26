import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CapsuleGeometry, CircleGeometry, Color, type InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, type Object3D, SphereGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { cameraRig } from "./cameraRig";
import { crowd, type CrowdLod } from "./crowdPlan";

/** Most characters the impostor and blob batches hold (a 40-player shard and the nine villagers). */
export const CROWD_CAPACITY = 64;

/**
 * Per-avatar side of the crowd level of detail (scene/crowdPlan.ts): report where the avatar is and
 * apply its level to the character meshes and name tag. Call from the avatar's useFrame.
 * Visibility and shadow flags only change when the level does.
 */
export function syncCrowdMember(
  id: string,
  at: { x: number; z: number; visible: boolean; color: string; pinned?: boolean },
  parts: { root: Object3D | null; tag: Object3D | null },
  applied: { current: AppliedLod | null },
): void {
  crowd.report({ id, x: at.x, z: at.z, visible: at.visible, color: at.color, ...(at.pinned ? { pinned: true } : {}) }, performance.now());
  const lod = crowd.lod(id);
  const last = applied.current;
  if (last && last.root === parts.root && last.tag === parts.tag && last.full === lod.full && last.shadow === lod.shadow) return;
  if (parts.root) {
    parts.root.visible = lod.full;
    parts.root.traverse((n) => {
      n.castShadow = lod.shadow;
    });
  }
  if (parts.tag) parts.tag.visible = lod.full;
  applied.current = { ...lod, root: parts.root, tag: parts.tag };
}

/** What syncCrowdMember last applied to an avatar (keep one per avatar in a ref). */
export interface AppliedLod extends CrowdLod {
  root: Object3D | null;
  tag: Object3D | null;
}

/** The impostor colour of a character: its shirt, else a warm neutral. */
export function shirtColor(character: { tints: ReadonlyMap<string, readonly { color: Color }[]> } | null): string {
  const m = character?.tints.get("shirt")?.[0];
  return m ? `#${m.color.getHexString()}` : "#c8a07a";
}

const matrix = new Matrix4();
const color = new Color();

/** A small tinted body (capsule and head), ~120 triangles, standing on y = 0. */
function impostorGeometry() {
  const body = new CapsuleGeometry(0.22, 0.38, 3, 8).translate(0, 0.42, 0);
  const head = new SphereGeometry(0.2, 8, 6).translate(0, 0.92, 0);
  const merged = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()], false)!;
  body.dispose();
  head.dispose();
  return merged;
}

/**
 * The crowd's planner and its two batches: the instanced impostors of every character not drawn
 * in full, and the blob shadows of every character without a real one. Mount once in the world.
 */
export function Crowd() {
  const impostorRef = useRef<InstancedMesh>(null);
  const blobRef = useRef<InstancedMesh>(null);
  const parts = useMemo(
    () => ({
      body: impostorGeometry(),
      bodyMaterial: new MeshStandardMaterial({ roughness: 0.9 }),
      blob: new CircleGeometry(0.42, 16).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
      blobMaterial: new MeshBasicMaterial({ color: "#2a2230", transparent: true, opacity: 0.28, depthWrite: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      parts.body.dispose();
      parts.bodyMaterial.dispose();
      parts.blob.dispose();
      parts.blobMaterial.dispose();
    },
    [parts],
  );

  useFrame(() => {
    const impostors = impostorRef.current;
    const blobs = blobRef.current;
    if (!impostors || !blobs) return;
    const focus = cameraRig.target;
    const plan = crowd.update([focus[0], focus[2]], performance.now());
    let k = 0;
    for (const id of plan.impostors) {
      const e = crowd.entry(id);
      if (!e?.visible || k >= CROWD_CAPACITY) continue;
      impostors.setMatrixAt(k, matrix.makeTranslation(e.x, 0, e.z));
      impostors.setColorAt(k, color.set(e.color));
      k++;
    }
    impostors.count = k;
    impostors.instanceMatrix.needsUpdate = true;
    if (impostors.instanceColor) impostors.instanceColor.needsUpdate = true;
    let b = 0;
    for (const id of plan.blobs) {
      const e = crowd.entry(id);
      if (!e?.visible || b >= CROWD_CAPACITY) continue;
      blobs.setMatrixAt(b++, matrix.makeTranslation(e.x, 0, e.z));
    }
    blobs.count = b;
    blobs.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={impostorRef} name="crowd-impostors" args={[parts.body, parts.bodyMaterial, CROWD_CAPACITY]} count={0} frustumCulled={false} />
      <instancedMesh ref={blobRef} name="crowd-blobs" args={[parts.blob, parts.blobMaterial, CROWD_CAPACITY]} count={0} frustumCulled={false} renderOrder={1} />
    </>
  );
}
