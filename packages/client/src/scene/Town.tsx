import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, MeshStandardMaterial } from "three";
import { COMMON_KIT_ID, difficultySigns, type StyleId, TOWN_BOUNDS } from "@hellovalley/shared";
import { useDiorama } from "../state/dioramaStore";
import { DifficultySigns } from "./DifficultySigns";
import { type KitLoader, kitLoader, type LoadedKit } from "./kitLoader";
import { SignIcons } from "./SignIcons";
import { buildCommonLayer, buildStyleLayer, disposeTownLayer, type TownLayer } from "./townMeshes";

interface Loaded {
  kit: LoadedKit;
  layer: TownLayer;
}

/**
 * Build a layer whenever `load` changes (keep it stable with useCallback); the old layer stays on
 * screen until the new one is ready.
 */
function useLayer(label: string, load: () => Promise<Loaded>): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = useRef<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await load();
        if (cancelled) {
          disposeTownLayer(next.layer);
          return;
        }
        const previous = current.current;
        current.current = next;
        setLoaded(next);
        if (previous) disposeTownLayer(previous.layer);
      } catch (error) {
        console.error(`town layer ${label}:`, error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [label, load]);

  useEffect(
    () => () => {
      if (current.current) disposeTownLayer(current.current.layer);
    },
    [],
  );
  return loaded;
}

/** The common (terrain, river, nature) and style (buildings) layers of the town. */
export function useTownLayers(style: StyleId, loader: KitLoader = kitLoader): { common: Loaded | null; style: Loaded | null } {
  const loadCommon = useCallback(async () => {
    const kit = await loader.load(COMMON_KIT_ID);
    return { kit, layer: await buildCommonLayer(kit) };
  }, [loader]);
  const loadStyle = useCallback(async () => {
    const kit = await loader.loadStyle(style);
    return { kit, layer: await buildStyleLayer(kit) };
  }, [loader, style]);
  const common = useLayer(COMMON_KIT_ID, loadCommon);
  const styled = useLayer(style, loadStyle);
  return { common, style: styled };
}

function LayerMeshes({ loaded }: { loaded: Loaded }) {
  const { kit, layer } = loaded;
  return (
    <>
      {layer.parts.map((part) => (
        <mesh
          key={`${layer.kitId}:${part.chunk}:${part.kind}:${part.ground ? "g" : "o"}`}
          geometry={part.geometry}
          material={kit.materials[part.kind]}
          castShadow={!part.ground}
          receiveShadow
        />
      ))}
    </>
  );
}

/** Depth of the diorama base under the ground. */
export const BASE_DEPTH = 1.6;

/** The four outer walls of the diorama base (no top or bottom, so nothing is hidden). */
export function baseWallsGeometry(bounds: readonly number[] = TOWN_BOUNDS, depth = BASE_DEPTH): BufferGeometry {
  const [x0, z0, x1, z1] = bounds as [number, number, number, number];
  const top = 0;
  const bottom = -depth;
  // Each wall: two corners along the edge, listed so the face points outwards.
  const walls: [number, number, number, number, [number, number, number]][] = [
    [x0, z1, x1, z1, [0, 0, 1]],
    [x1, z1, x1, z0, [1, 0, 0]],
    [x1, z0, x0, z0, [0, 0, -1]],
    [x0, z0, x0, z1, [-1, 0, 0]],
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  walls.forEach(([ax, az, bx, bz, n], w) => {
    position.push(ax, top, az, bx, top, bz, ax, bottom, az, bx, bottom, bz);
    for (let k = 0; k < 4; k++) normal.push(...n);
    const b = w * 4;
    index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(normal), 3));
  g.setIndex(index);
  return g;
}

export interface TownProps {
  /** Override the store's town style (dev pages). */
  style?: StyleId;
  loader?: KitLoader;
}

/**
 * The whole town (GDD §4.1, build plan M11): merged terrain and nature chunks from the common kit,
 * the ten buildings and street furniture in the active style kit, shop sign icons, the leaf
 * difficulty signs and the diorama base. Switching the style swaps only the style layer.
 */
export function Town({ style, loader }: TownProps) {
  const storeStyle = useDiorama((s) => s.style);
  const { common, style: styled } = useTownLayers(style ?? storeStyle, loader);
  const signs = useMemo(() => difficultySigns(), []);
  const base = useMemo(() => ({ geometry: baseWallsGeometry(), material: new MeshStandardMaterial({ color: "#8a6a52", roughness: 1 }) }), []);
  useEffect(
    () => () => {
      base.geometry.dispose();
      base.material.dispose();
    },
    [base],
  );

  return (
    <group name="town">
      {common ? <LayerMeshes loaded={common} /> : null}
      {styled ? (
        <>
          <LayerMeshes loaded={styled} />
          <SignIcons signs={styled.layer.signs} />
        </>
      ) : null}
      <DifficultySigns signs={signs} />
      <mesh geometry={base.geometry} material={base.material} receiveShadow />
    </group>
  );
}
