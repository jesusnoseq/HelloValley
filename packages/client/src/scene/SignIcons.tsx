import { useLayoutEffect, useMemo, useRef } from "react";
import { CanvasTexture, type InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from "three";
import type { SignIcon } from "@hellovalley/shared";
import type { BuildingSign } from "./buildingMeshes";

/**
 * Shop icons on `sign.hanging` boards, drawn at the board's `icon` sockets. Placeholder glyphs
 * painted on a canvas; TODO(backlog): the hand-drawn icon set (art.md) as an atlas.
 */
export const SIGN_ICON_GLYPHS: Readonly<Record<SignIcon, string>> = {
  bread: "🥖",
  wheat: "🌾",
  basket: "🧺",
  cross: "✚",
  coffee: "☕",
  heart: "♥",
  scroll: "📜",
  book: "📚",
  teapot: "🫖",
  home: "🏠",
};

/** Icon size on the board in metres (the board is about 0.44 m square). */
export const SIGN_ICON_SIZE = 0.3;
/** Lift off the board so the icon never z-fights with it. */
const SURFACE_OFFSET = 0.004;

const plane = new PlaneGeometry(SIGN_ICON_SIZE, SIGN_ICON_SIZE);
const materials = new Map<SignIcon, MeshStandardMaterial>();

function iconMaterial(icon: SignIcon): MeshStandardMaterial {
  let material = materials.get(icon);
  if (material) return material;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fbf3df";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#7a5a43";
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = icon === "cross" ? "#d9534f" : icon === "heart" ? "#e06c8c" : "#3d3a44";
    ctx.font = `${size * 0.55}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.fillText(SIGN_ICON_GLYPHS[icon], size / 2, size / 2 + 4);
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  material = new MeshStandardMaterial({ map, transparent: true, alphaTest: 0.5, roughness: 0.8 });
  materials.set(icon, material);
  return material;
}

const FORWARD = new Vector3(0, 0, 1);
const UNIT = new Vector3(1, 1, 1);

/** Icon planes, one instanced mesh per icon (a building or the whole town is a few draw calls). */
export function SignIcons({ signs }: { signs: readonly BuildingSign[] }) {
  const groups = useMemo(() => {
    const byIcon = new Map<SignIcon, Matrix4[]>();
    for (const s of signs) {
      const normal = new Vector3(...s.normal).normalize();
      const position = new Vector3(...s.position).addScaledVector(normal, SURFACE_OFFSET);
      const matrix = new Matrix4().compose(position, new Quaternion().setFromUnitVectors(FORWARD, normal), UNIT);
      const list = byIcon.get(s.icon) ?? [];
      list.push(matrix);
      byIcon.set(s.icon, list);
    }
    return [...byIcon].map(([icon, matrices]) => ({ icon, matrices, material: iconMaterial(icon) }));
  }, [signs]);
  return (
    <>
      {groups.map((g) => (
        <IconInstances key={`${g.icon}:${g.matrices.length}`} matrices={g.matrices} material={g.material} />
      ))}
    </>
  );
}

function IconInstances({ matrices, material }: { matrices: readonly Matrix4[]; material: MeshStandardMaterial }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[plane, material, matrices.length]} />;
}
