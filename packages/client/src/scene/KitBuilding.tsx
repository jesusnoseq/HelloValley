import { useEffect, useRef, useState } from "react";
import type { BuildingRecipe, StyleId } from "@hellovalley/shared";
import { useDiorama } from "../state/dioramaStore";
import { type BuildingMeshes, buildBuildingMeshes, disposeBuildingMeshes } from "./buildingMeshes";
import { type KitLoader, kitLoader, type LoadedKit } from "./kitLoader";
import { SignIcons } from "./SignIcons";

interface Loaded {
  kit: LoadedKit;
  meshes: BuildingMeshes;
}

/**
 * Builds a recipe's merged meshes with the kit of `style`. When the style changes, the old
 * meshes stay on screen until the new kit's are ready, then swap in place: placements come from
 * the style-agnostic recipe, so nothing moves.
 */
export function useBuildingMeshes(recipe: BuildingRecipe, style: StyleId, loader: KitLoader = kitLoader): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = useRef<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const kit = await loader.loadStyle(style);
        const meshes = await buildBuildingMeshes(recipe, kit);
        if (cancelled) {
          disposeBuildingMeshes(meshes);
          return;
        }
        const previous = current.current;
        current.current = { kit, meshes };
        setLoaded(current.current);
        if (previous) disposeBuildingMeshes(previous.meshes);
      } catch (error) {
        console.error(`building ${recipe.id} (${style}):`, error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipe, style, loader]);

  useEffect(
    () => () => {
      if (current.current) disposeBuildingMeshes(current.current.meshes);
    },
    [],
  );

  return loaded;
}

export interface KitBuildingProps {
  recipe: BuildingRecipe;
  /** World position of the building pivot (front-left footprint corner at ground level). */
  position?: [number, number, number];
  /** Quarter turns about +Y. */
  rot?: number;
  /** Override the store's town style (dev pages). */
  style?: StyleId;
  loader?: KitLoader;
}

/** One assembled building: a mesh per material slot plus its sign icons. */
export function KitBuilding({ recipe, position = [0, 0, 0], rot = 0, style, loader }: KitBuildingProps) {
  const storeStyle = useDiorama((s) => s.style);
  const loaded = useBuildingMeshes(recipe, style ?? storeStyle, loader);
  if (!loaded) return null;
  const { kit, meshes } = loaded;
  return (
    <group position={position} rotation-y={(rot * Math.PI) / 2} name={`building:${recipe.id}`}>
      {meshes.parts.map((part) => (
        <mesh key={`${meshes.kitId}:${part.kind}`} geometry={part.geometry} material={kit.materials[part.kind]} castShadow receiveShadow />
      ))}
      <SignIcons signs={meshes.signs} />
    </group>
  );
}
