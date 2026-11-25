import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Group, MeshStandardMaterial } from "three";
import { INTERIOR_KIT_ID, INTERIOR_WALL_T, type InteriorId, interiorLayout, ROOM_SIDES, type RoomSide } from "@hellovalley/shared";
import { useApartmentLayout } from "./apartmentLayout";
import { worldStore } from "../state/worldStore";
import { cameraRig } from "./cameraRig";
import { buildInteriorMeshes, disposeInteriorMeshes, type InteriorMeshes } from "./interiorMeshes";
import { type KitLoader, kitLoader, type LoadedKit } from "./kitLoader";
import { CUTAWAY_STUB, cutawaySides } from "./playerMath";
import { baseWallsGeometry } from "./Town";

/** Depth of the interior's diorama base under the floor. */
const BASE_DEPTH = 0.5;

/**
 * One interior scene (build plan M13, GDD §4.1): the room's floor, furniture and walls from the
 * interior kit, drawn at the origin of the interior frame while the town is hidden. Diorama
 * cut-away: the walls whose outside faces the camera shrink to a low stub (the doorway shows as a
 * gap in it) and their mirrors and paintings disappear, updated every frame from the camera
 * yaw, so Q/E rotation reveals the other side. The apartment shows the furniture layout of the
 * ApartmentRoom the player is in (build plan M17); after an edit the new meshes replace the old
 * ones once built, so nothing flickers.
 */
export function Interior({ id, loader = kitLoader }: { id: InteriorId; loader?: KitLoader }) {
  const apartment = useApartmentLayout().interior;
  const layout = id === "apartment" ? apartment : interiorLayout(id);
  const [built, setBuilt] = useState<{ kit: LoadedKit; meshes: InteriorMeshes } | null>(null);
  const shown = useRef<InteriorMeshes | null>(null);
  const sides = useRef<Partial<Record<RoomSide, Group | null>>>({});
  const decor = useRef<Partial<Record<RoomSide, Group | null>>>({});

  // A different room starts from nothing (the fade waits for it); a new layout of the same room
  // keeps showing the old meshes until the new ones are ready.
  useEffect(() => {
    worldStore.getState().setReady(false);
    return () => {
      if (shown.current) disposeInteriorMeshes(shown.current);
      shown.current = null;
      setBuilt(null);
    };
  }, [id, loader]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const kit = await loader.load(INTERIOR_KIT_ID);
        const meshes = await buildInteriorMeshes(layout, kit);
        if (cancelled) {
          disposeInteriorMeshes(meshes);
          return;
        }
        const old = shown.current;
        shown.current = meshes;
        setBuilt({ kit, meshes });
        // React renders the new meshes first; the old geometry goes after that frame.
        if (old) requestAnimationFrame(() => disposeInteriorMeshes(old));
      } catch (error) {
        console.error(`interior ${id}:`, error);
        // Let the fade finish rather than holding a covered screen.
        if (!cancelled) worldStore.getState().setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, layout, loader]);

  useEffect(() => {
    if (built) worldStore.getState().setReady(true);
  }, [built]);

  const base = useMemo(() => {
    const t = INTERIOR_WALL_T;
    return {
      geometry: baseWallsGeometry([-t, -t, layout.w + t, layout.d + t], BASE_DEPTH),
      material: new MeshStandardMaterial({ color: "#8a6a52", roughness: 1 }),
    };
  }, [layout]);
  useEffect(
    () => () => {
      base.geometry.dispose();
      base.material.dispose();
    },
    [base],
  );

  useFrame(() => {
    const lowered = cutawaySides(cameraRig.yaw);
    for (const side of ROOM_SIDES) {
      const g = sides.current[side];
      if (g) g.scale.y = lowered.includes(side) ? CUTAWAY_STUB : 1;
      const d = decor.current[side];
      if (d) d.visible = !lowered.includes(side);
    }
  });

  if (!built) return null;
  const { kit, meshes } = built;
  const mesh = (p: InteriorMeshes["parts"][number]) => (
    <mesh key={`${p.group}:${p.kind}`} geometry={p.geometry} material={kit.materials[p.kind]} castShadow receiveShadow />
  );
  return (
    <group name={`interior:${id}`}>
      {meshes.parts.filter((p) => p.group === "room").map(mesh)}
      {ROOM_SIDES.map((side) => (
        <group
          key={side}
          ref={(g) => {
            sides.current[side] = g;
          }}
        >
          {meshes.parts.filter((p) => p.group === side).map(mesh)}
        </group>
      ))}
      {ROOM_SIDES.map((side) => (
        <group
          key={`decor:${side}`}
          ref={(g) => {
            decor.current[side] = g;
          }}
        >
          {meshes.parts.filter((p) => p.group === `decor:${side}`).map(mesh)}
        </group>
      ))}
      <mesh geometry={base.geometry} material={base.material} receiveShadow />
    </group>
  );
}
