import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  type InstancedMesh,
  type MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from "three";
import { dioramaStore } from "../state/dioramaStore";
import { lightingAt } from "./dayNight";
import { TEST_BASE_SIZE, TEST_ROAD_HALF_WIDTH, testSceneLayout } from "./testScene";

/** Emissive intensity of lamp bulbs at full night; above 1 so the bloom threshold picks it up. */
const LAMP_GLOW = 6;

// Unit geometries with their base on y = 0, shared by every instance.
const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
// A 4-sided cone turned 45° is a pyramid roof whose base matches a unit box.
const roof = new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
const trunk = new CylinderGeometry(0.12, 0.16, 1, 6).translate(0, 0.5, 0);
const canopy = new IcosahedronGeometry(1, 1);
const post = new CylinderGeometry(0.06, 0.08, 1, 6).translate(0, 0.5, 0);
const bulb = new SphereGeometry(0.18, 10, 8);

const dummy = new Object3D();
const color = new Color();

type Placement = { x: number; y: number; z: number; sx: number; sy: number; sz: number; color?: string };

function fill(mesh: InstancedMesh | null, items: readonly Placement[]) {
  if (!mesh) return;
  items.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.scale.set(p.sx, p.sy, p.sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (p.color) mesh.setColorAt(i, color.set(p.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/**
 * Placeholder diorama for the M09 renderer: a square base with a road cross, pastel blocks with
 * pyramid roofs, cloud trees and street lamps that glow at night. Each kind is one instanced mesh,
 * so the scene costs about a dozen draw calls. TODO(M10/M11): replace with kit buildings and the town.
 */
export function TestBlocks() {
  const layout = useMemo(() => testSceneLayout(), []);
  const walls = useRef<InstancedMesh>(null);
  const roofs = useRef<InstancedMesh>(null);
  const trunks = useRef<InstancedMesh>(null);
  const canopies = useRef<InstancedMesh>(null);
  const posts = useRef<InstancedMesh>(null);
  const bulbs = useRef<InstancedMesh>(null);
  const bulbMaterial = useRef<MeshStandardMaterial>(null);

  useLayoutEffect(() => {
    const { blocks, trees, lamps } = layout;
    fill(walls.current, blocks.map((b) => ({ x: b.x, y: 0, z: b.z, sx: b.width, sy: b.height, sz: b.depth, color: b.wall })));
    fill(
      roofs.current,
      blocks.map((b) => ({ x: b.x, y: b.height, z: b.z, sx: b.width + 0.3, sy: b.roofHeight, sz: b.depth + 0.3, color: b.roof })),
    );
    fill(trunks.current, trees.map((t) => ({ x: t.x, y: 0, z: t.z, sx: t.scale, sy: t.scale * 1.1, sz: t.scale })));
    fill(
      canopies.current,
      trees.map((t) => ({ x: t.x, y: t.scale * 1.7, z: t.z, sx: t.scale * 0.9, sy: t.scale * 0.8, sz: t.scale * 0.9, color: t.canopy })),
    );
    fill(posts.current, lamps.map((l) => ({ x: l.x, y: 0, z: l.z, sx: 1, sy: 2.2, sz: 1 })));
    fill(bulbs.current, lamps.map((l) => ({ x: l.x, y: 2.3, z: l.z, sx: 1, sy: 1, sz: 1 })));
  }, [layout]);

  useFrame(() => {
    const m = bulbMaterial.current;
    if (m) m.emissiveIntensity = 0.2 + LAMP_GLOW * lightingAt(dioramaStore.getState().worldTime).nightGlow;
  });

  const { blocks, trees, lamps } = layout;
  const road = TEST_ROAD_HALF_WIDTH * 2 - 0.5;
  return (
    <group>
      {/* Diorama base: grass slab over a soil block. */}
      <mesh position={[0, -0.15, 0]} receiveShadow>
        <boxGeometry args={[TEST_BASE_SIZE, 0.3, TEST_BASE_SIZE]} />
        <meshStandardMaterial color="#a9cf86" roughness={0.95} />
      </mesh>
      <mesh position={[0, -1.3, 0]}>
        <boxGeometry args={[TEST_BASE_SIZE - 0.2, 2, TEST_BASE_SIZE - 0.2]} />
        <meshStandardMaterial color="#8a6a52" roughness={1} />
      </mesh>
      {/* Road cross. */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TEST_BASE_SIZE, road]} />
        <meshStandardMaterial color="#e3d5b8" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} receiveShadow>
        <planeGeometry args={[TEST_BASE_SIZE, road]} />
        <meshStandardMaterial color="#e3d5b8" roughness={0.95} />
      </mesh>

      <instancedMesh ref={walls} args={[box, undefined, blocks.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[roof, undefined, blocks.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.8} flatShading />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[trunk, undefined, trees.length]} castShadow>
        <meshStandardMaterial color="#7a5a43" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[canopy, undefined, trees.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={posts} args={[post, undefined, lamps.length]} castShadow>
        <meshStandardMaterial color="#4b4f5c" roughness={0.6} metalness={0.2} />
      </instancedMesh>
      <instancedMesh ref={bulbs} args={[bulb, undefined, lamps.length]}>
        <meshStandardMaterial ref={bulbMaterial} color="#fff4d6" emissive="#ffc46b" roughness={0.4} />
      </instancedMesh>
    </group>
  );
}
