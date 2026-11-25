import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, MeshBasicMaterial, Plane, Raycaster, Vector2, Vector3 } from "three";
import {
  applyFurnitureEdit,
  entryArea,
  type FurnitureEdit,
  furnitureAt,
  furnitureDef,
  INTERIOR_FURNITURE,
  INTERIOR_LAYOUTS,
  INTERIOR_TABLE_TOP_M,
  snapPlacement,
  type Vec2,
} from "@hellovalley/shared";
import { sendFurnitureEdit } from "../net/apartmentSession";
import { type HeldPiece, placementStore, usePlacement } from "../state/placementStore";
import { useWorld } from "../state/worldStore";
import { currentApartment, useApartmentLayout } from "./apartmentLayout";

/** The pointer position is kept on this grid so moving within a cell does not re-render. */
const POINTER_STEP_M = 0.125;
const ROOM = INTERIOR_LAYOUTS.apartment;

/** The edit that drops `held` at the ghost's spot. */
export function dropEdit(held: HeldPiece, at: { x: number; z: number; rot: 0 | 90 | 180 | 270 }): FurnitureEdit {
  return held.kind === "placed"
    ? { op: "move", index: held.index, itemId: held.itemId, ...at }
    : { op: "place", itemId: held.itemId, ...at };
}

/** Vertical extent of a ghost box for a piece's mount (metres). */
function ghostHeight(itemId: HeldPiece["itemId"]): [number, number] {
  const mount = INTERIOR_FURNITURE[furnitureDef(itemId).module].mount;
  if (mount === "rug") return [0, 0.04];
  if (mount === "wall") return [1, 2];
  if (mount === "surface") return [INTERIOR_TABLE_TOP_M, INTERIOR_TABLE_TOP_M + 0.35];
  return [0, 0.9];
}

/**
 * Furniture placement mode in the scene (build plan M17): while it is open in the apartment, a
 * 0.5 m grid lies on the floor, hovering shows the piece under the pointer, a click picks it up
 * and a ghost box follows the pointer (snapped with the shared `snapPlacement`, green when the
 * shared placement rules accept the spot, red when not). A click drops it (the ApartmentRoom
 * validates the edit again), R turns it, Delete / X stores it, Esc puts it back or closes.
 */
export function PlacementMode() {
  const open = usePlacement((s) => s.open);
  const space = useWorld((s) => s.space);
  return open && space === "apartment" ? <PlacementGhost /> : null;
}

function PlacementGhost() {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const { layout } = useApartmentLayout();
  const held = usePlacement((s) => s.held);
  const rot = usePlacement((s) => s.rot);
  const [pointer, setPointer] = useState<Vec2 | null>(null);

  const ghost = useMemo(() => {
    if (!held) return null;
    // Until the pointer moves, a picked-up piece's ghost starts where the piece stands.
    const from = held.kind === "placed" && layout.furniture[held.index] ? entryArea(layout.furniture[held.index]!) : null;
    const point: Vec2 | null = pointer ?? (from ? [(from[0] + from[2]) / 2, (from[1] + from[3]) / 2] : null);
    if (!point) return null;
    const at = snapPlacement(held.itemId, point, rot);
    const edit = dropEdit(held, at);
    return { at, edit, ok: applyFurnitureEdit(layout, edit).ok, area: entryArea({ itemId: held.itemId, ...at }), y: ghostHeight(held.itemId) };
  }, [held, pointer, rot, layout]);
  const hovered = useMemo(() => {
    if (held || !pointer) return null;
    const k = furnitureAt(layout, pointer);
    if (k === null) return null;
    const e = layout.furniture[k]!;
    return { area: entryArea(e), y: ghostHeight(e.itemId), fixed: furnitureDef(e.itemId).fixed };
  }, [held, pointer, layout]);

  // Pointer: the floor point under it, and clicks to pick up and drop.
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const floor = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    const pointAt = (e: PointerEvent): Vec2 | null => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      return raycaster.ray.intersectPlane(floor, hit) ? [hit.x, hit.z] : null;
    };
    const snapPointer = (p: Vec2 | null): Vec2 | null =>
      p ? [Math.round(p[0] / POINTER_STEP_M) * POINTER_STEP_M, Math.round(p[1] / POINTER_STEP_M) * POINTER_STEP_M] : null;
    const onMove = (e: PointerEvent) => {
      const p = snapPointer(pointAt(e));
      setPointer((prev) => (prev && p && prev[0] === p[0] && prev[1] === p[1] ? prev : p));
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = pointAt(e);
      if (!p) return;
      const { held: inHand, rot: r } = placementStore.getState();
      const current = currentApartment().layout;
      if (inHand) {
        const edit = dropEdit(inHand, snapPlacement(inHand.itemId, p, r));
        if (!applyFurnitureEdit(current, edit).ok) return;
        sendFurnitureEdit(edit);
        placementStore.getState().hold(null);
        return;
      }
      const k = furnitureAt(current, p);
      const e2 = k === null ? null : current.furniture[k]!;
      if (k === null || !e2 || furnitureDef(e2.itemId).fixed) return;
      placementStore.getState().hold({ kind: "placed", index: k, itemId: e2.itemId }, e2.rot);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [gl, get]);

  // Keys: R turns, Delete / Backspace / X stores, Esc puts back or closes.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const s = placementStore.getState();
      if (e.code === "KeyR") s.rotate();
      else if (e.code === "Escape") {
        if (s.held) s.hold(null);
        else s.setOpen(false);
      } else if ((e.code === "Delete" || e.code === "Backspace" || e.code === "KeyX") && s.held?.kind === "placed") {
        sendFurnitureEdit({ op: "store", index: s.held.index, itemId: s.held.itemId });
        s.hold(null);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const resources = useMemo(() => {
    const lines: number[] = [];
    for (let x = 0; x <= ROOM.w + 1e-9; x += 0.5) lines.push(x, 0.012, 0, x, 0.012, ROOM.d);
    for (let z = 0; z <= ROOM.d + 1e-9; z += 0.5) lines.push(0, 0.012, z, ROOM.w, 0.012, z);
    const grid = new BufferGeometry();
    grid.setAttribute("position", new Float32BufferAttribute(lines, 3));
    return {
      grid,
      gridMaterial: new LineBasicMaterial({ color: "#fff6e0", transparent: true, opacity: 0.45, depthWrite: false }),
      ok: new MeshBasicMaterial({ color: "#7bd88f", transparent: true, opacity: 0.45, depthWrite: false }),
      bad: new MeshBasicMaterial({ color: "#ff7a7a", transparent: true, opacity: 0.45, depthWrite: false }),
      hover: new MeshBasicMaterial({ color: "#ffe28a", transparent: true, opacity: 0.35, depthWrite: false }),
      fixed: new MeshBasicMaterial({ color: "#b9b4c4", transparent: true, opacity: 0.3, depthWrite: false }),
    };
  }, []);
  useEffect(
    () => () => {
      resources.grid.dispose();
      for (const m of [resources.gridMaterial, resources.ok, resources.bad, resources.hover, resources.fixed]) m.dispose();
    },
    [resources],
  );

  const box = (area: readonly number[], y: [number, number], material: MeshBasicMaterial) => {
    const [x0, z0, x1, z1] = area as [number, number, number, number];
    return (
      <mesh position={[(x0 + x1) / 2, (y[0] + y[1]) / 2, (z0 + z1) / 2]} scale={[x1 - x0 + 0.02, y[1] - y[0] + 0.02, z1 - z0 + 0.02]} material={material} renderOrder={6}>
        <boxGeometry />
      </mesh>
    );
  };

  return (
    <group name="placement-mode">
      <lineSegments geometry={resources.grid} material={resources.gridMaterial} renderOrder={5} />
      {ghost ? box(ghost.area, ghost.y, ghost.ok ? resources.ok : resources.bad) : null}
      {hovered ? box(hovered.area, hovered.y, hovered.fixed ? resources.fixed : resources.hover) : null}
    </group>
  );
}
