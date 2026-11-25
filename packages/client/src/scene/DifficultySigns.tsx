import { useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, BufferAttribute, type BufferGeometry, Color, type InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Shape, ShapeGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { DifficultySign } from "@hellovalley/shared";

/**
 * The 1–5 leaf difficulty signs in front of the buildings (GDD §4.1): a post with a cream board
 * and a row of leaves on both faces. Two instanced meshes for the whole town (posts and leaves).
 * Placeholder geometry built here; TODO(M37): a kit `sign.difficulty` module and the hand-drawn
 * leaf icon.
 */

export const SIGN_BOARD = { w: 0.78, h: 0.34, depth: 0.05, centreY: 1.05 } as const;
export const LEAF_SIZE = 0.12;
const LEAF_SPACING = 0.14;

function painted(g: BufferGeometry, hex: string): BufferGeometry {
  const c = new Color(hex);
  const colors = new Float32Array(g.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  g.setAttribute("color", new BufferAttribute(colors, 3));
  g.deleteAttribute("uv");
  return g;
}

function postGeometry(): BufferGeometry {
  const post = painted(new BoxGeometry(0.08, SIGN_BOARD.centreY + 0.1, 0.08).translate(0, (SIGN_BOARD.centreY + 0.1) / 2, 0), "#8a6446");
  const board = painted(new BoxGeometry(SIGN_BOARD.w, SIGN_BOARD.h, SIGN_BOARD.depth).translate(0, SIGN_BOARD.centreY, 0), "#f6ecd2");
  return mergeGeometries([post, board], false)!;
}

function leafGeometry(): ShapeGeometry {
  const s = LEAF_SIZE;
  const shape = new Shape();
  shape.moveTo(0, -s / 2);
  shape.quadraticCurveTo(s * 0.45, 0, 0, s / 2);
  shape.quadraticCurveTo(-s * 0.45, 0, 0, -s / 2);
  return new ShapeGeometry(shape, 3);
}

/** Leaf offsets on the board face (x along the board, y up), centred. */
export function leafOffsets(leaves: number): number[] {
  return Array.from({ length: leaves }, (_, k) => (k - (leaves - 1) / 2) * LEAF_SPACING);
}

const Y = new Vector3(0, 1, 0);

export function DifficultySigns({ signs }: { signs: readonly DifficultySign[] }) {
  const resources = useMemo(
    () => ({
      post: postGeometry(),
      leaf: leafGeometry(),
      postMaterial: new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      leafMaterial: new MeshStandardMaterial({ color: "#5f9e4a", roughness: 0.7 }),
    }),
    [],
  );
  const posts = useRef<InstancedMesh>(null);
  const leaves = useRef<InstancedMesh>(null);
  const leafCount = signs.reduce((n, s) => n + s.leaves * 2, 0);

  useLayoutEffect(() => {
    const p = posts.current;
    const l = leaves.current;
    if (!p || !l) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const leafLocal = new Matrix4();
    let k = 0;
    signs.forEach((s, i) => {
      q.setFromAxisAngle(Y, (s.rot * Math.PI) / 2);
      m.compose(new Vector3(s.position[0], 0, s.position[1]), q, new Vector3(1, 1, 1));
      p.setMatrixAt(i, m);
      for (const face of [1, -1]) {
        for (const x of leafOffsets(s.leaves)) {
          // Leaves lean a little, like a hand-painted row; the back face mirrors the front.
          leafLocal.compose(
            new Vector3(x * face, SIGN_BOARD.centreY, face * (SIGN_BOARD.depth / 2 + 0.003)),
            new Quaternion().setFromAxisAngle(Y, face > 0 ? 0 : Math.PI).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.35)),
            new Vector3(1, 1, 1),
          );
          l.setMatrixAt(k++, new Matrix4().multiplyMatrices(m, leafLocal));
        }
      }
    });
    p.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
    p.computeBoundingSphere();
    l.computeBoundingSphere();
  }, [signs]);

  useLayoutEffect(
    () => () => {
      resources.post.dispose();
      resources.leaf.dispose();
      resources.postMaterial.dispose();
      resources.leafMaterial.dispose();
    },
    [resources],
  );

  return (
    <>
      <instancedMesh key={`posts:${signs.length}`} ref={posts} args={[resources.post, resources.postMaterial, signs.length]} castShadow receiveShadow />
      <instancedMesh key={`leaves:${leafCount}`} ref={leaves} args={[resources.leaf, resources.leafMaterial, leafCount]} />
    </>
  );
}
