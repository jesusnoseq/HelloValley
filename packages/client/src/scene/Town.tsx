import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type BatchedMesh, BufferAttribute, BufferGeometry, type Material, MeshStandardMaterial } from "three";
import { COMMON_KIT_ID, difficultySigns, type StyleId, TOWN_BOUNDS } from "@hellovalley/shared";
import { useDiorama } from "../state/dioramaStore";
import { DifficultySigns } from "./DifficultySigns";
import type { DrawItem } from "./drawCalls";
import { type KitLoader, kitLoader, type LoadedKit } from "./kitLoader";
import { SignIcons } from "./SignIcons";
import { createRiverMaterial, disposeRiverMaterial } from "./riverMaterial";
import { buildCommonLayer, buildStyleLayer, disposeTownLayer, sampleFlats, type TownLayer } from "./townMeshes";
import { buildVegetation, createSwayMaterial, createVegetationMesh, disposeVegetation, type VegetationBatch } from "./vegetation";

interface Loaded {
  kit: LoadedKit;
  /** Kits whose materials the layer's parts use, by id (the style layer also uses the common kit). */
  kits: ReadonlyMap<string, LoadedKit>;
  layer: TownLayer;
  /** The swaying canopies and grass (common layer only). */
  vegetation?: VegetationBatch;
}

function disposeLoaded(loaded: Loaded): void {
  disposeTownLayer(loaded.layer);
  if (loaded.vegetation) disposeVegetation(loaded.vegetation);
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
          disposeLoaded(next);
          return;
        }
        const previous = current.current;
        current.current = next;
        setLoaded(next);
        if (previous) disposeLoaded(previous);
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
      if (current.current) disposeLoaded(current.current);
    },
    [],
  );
  return loaded;
}

/** The common (terrain, river, nature) and style (buildings) layers of the town. */
export function useTownLayers(style: StyleId, loader: KitLoader = kitLoader): { common: Loaded | null; style: Loaded | null } {
  const loadCommon = useCallback(async () => {
    const kit = await loader.load(COMMON_KIT_ID);
    const [layer, samples] = await Promise.all([buildCommonLayer(kit), sampleFlats(kit)]);
    return { kit, kits: new Map([[kit.id, kit]]), layer, vegetation: await buildVegetation(kit, samples.ground.grass) };
  }, [loader]);
  const loadStyle = useCallback(async () => {
    const [kit, common] = await Promise.all([loader.loadStyle(style), loader.load(COMMON_KIT_ID)]);
    return { kit, kits: new Map([[kit.id, kit], [common.id, common]]), layer: await buildStyleLayer(kit, common) };
  }, [loader, style]);
  const common = useLayer(COMMON_KIT_ID, loadCommon);
  const styled = useLayer(style, loadStyle);
  return { common, style: styled };
}

function LayerMeshes({ loaded, water }: { loaded: Loaded; water?: Material }) {
  const { kit, kits, layer } = loaded;
  return (
    <>
      {layer.parts.map((part) => (
        <mesh
          key={`${layer.kitId}:${part.kit}:${part.chunk}:${part.kind}:${part.ground ? "g" : "o"}`}
          geometry={part.geometry}
          material={part.kind === "water" && water ? water : (kits.get(part.kit) ?? kit).materials[part.kind]}
          castShadow={!part.ground && part.kind !== "water"}
          receiveShadow
        />
      ))}
    </>
  );
}

/** Effects currently using each vegetation mesh (StrictMode mounts effects twice in dev). */
const vegetationMounts = new Map<BatchedMesh, number>();

/**
 * The vegetation batch as one BatchedMesh with the sway material (rebuilt if the batch changes).
 * BatchedMesh.dispose() cannot be undone, so disposal waits a tick and is skipped if the same
 * mesh was mounted again in the meantime (StrictMode's effect replay).
 */
function Vegetation({ batch, material }: { batch: VegetationBatch; material: Material }) {
  const mesh = useMemo<BatchedMesh>(() => createVegetationMesh(batch, material), [batch, material]);
  useEffect(() => {
    vegetationMounts.set(mesh, (vegetationMounts.get(mesh) ?? 0) + 1);
    return () => {
      vegetationMounts.set(mesh, (vegetationMounts.get(mesh) ?? 1) - 1);
      setTimeout(() => {
        if ((vegetationMounts.get(mesh) ?? 0) > 0) return;
        vegetationMounts.delete(mesh);
        mesh.customDepthMaterial?.dispose();
        mesh.dispose();
      }, 0);
    };
  }, [mesh]);
  return <primitive object={mesh} />;
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

/**
 * Every mesh the town and its weather put in the scene, for the draw-call estimate (keep in step
 * with what `Town`, `Weather` and `DioramaCanvas` render).
 */
export function townDrawItems(common: TownLayer, style: TownLayer, vegetation: VegetationBatch | null): DrawItem[] {
  const items: DrawItem[] = [];
  for (const layer of [common, style]) {
    for (const p of layer.parts) items.push({ label: `${layer.kitId}:${p.kit}:${p.chunk}:${p.kind}`, castShadow: !p.ground && p.kind !== "water" });
  }
  if (vegetation && vegetation.instances.length > 0) items.push({ label: "vegetation", castShadow: true });
  for (const v of style.vegetation) if (v.batch.instances.length > 0) items.push({ label: `vegetation ${v.kit}`, castShadow: true });
  for (const icon of new Set(style.signs.map((s) => s.icon))) items.push({ label: `sign icon ${icon}`, castShadow: false });
  items.push({ label: "difficulty sign posts", castShadow: true }, { label: "difficulty sign leaves", castShadow: false });
  items.push({ label: "diorama base", castShadow: false });
  items.push({ label: "rain", castShadow: false });
  return items;
}

export interface TownProps {
  /** Override the store's town style (dev pages). */
  style?: StyleId;
  loader?: KitLoader;
  /** Hidden (not unmounted) while the player is inside a building, so coming out is instant. */
  visible?: boolean;
}

/**
 * The whole town (GDD §4.1, build plan M11): merged terrain and nature chunks from the common kit
 * with the river shader on their water (M12), the swaying vegetation batch, the ten buildings and
 * street furniture in the active style kit, the props the style dresses differently (M34), shop
 * sign icons, the leaf difficulty signs and the diorama base. Switching the style swaps only the
 * style layer; the old one stays on screen until the new one is built.
 */
export function Town({ style, loader, visible = true }: TownProps) {
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
  const river = useMemo(() => createRiverMaterial(), []);
  useEffect(() => () => disposeRiverMaterial(river), [river]);
  const atlas = common?.kit.atlas ?? null;
  const sway = useMemo(() => createSwayMaterial(atlas), [atlas]);
  useEffect(() => () => sway.dispose(), [sway]);
  // The style layer's dressed plants sway too, with their own kit's atlas.
  const styleAtlas = styled?.kit.atlas ?? null;
  const styleSway = useMemo(() => createSwayMaterial(styleAtlas), [styleAtlas]);
  useEffect(() => () => styleSway.dispose(), [styleSway]);

  return (
    <group name="town" visible={visible}>
      {common ? <LayerMeshes loaded={common} water={river} /> : null}
      {common?.vegetation ? <Vegetation batch={common.vegetation} material={sway} /> : null}
      {styled ? (
        <>
          <LayerMeshes loaded={styled} water={river} />
          {styled.layer.vegetation.map((v) => (
            <Vegetation key={`${styled.layer.kitId}:${v.kit}`} batch={v.batch} material={v.kit === styled.kit.id ? styleSway : sway} />
          ))}
          <SignIcons signs={styled.layer.signs} />
        </>
      ) : null}
      <DifficultySigns signs={signs} />
      <mesh geometry={base.geometry} material={base.material} receiveShadow />
    </group>
  );
}
