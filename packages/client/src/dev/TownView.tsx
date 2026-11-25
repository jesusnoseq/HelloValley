import type { ThreeEvent } from "@react-three/fiber";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { BufferGeometry, DataTexture, Float32BufferAttribute, Line, LineBasicMaterial, NearestFilter, RGBAFormat, SRGBColorSpace } from "three";
import {
  findPath,
  isStyleId,
  nearestWalkable,
  type PlaceId,
  SPAWN_POINT,
  STYLE_IDS,
  STYLES,
  TOWN_CENTER,
  TOWN_D,
  TOWN_W,
  townNavGrid,
  townPlaces,
  type Vec2,
} from "@hellovalley/shared";
import { ZOOM_LEVELS } from "../scene/cameraMath";
import { DioramaView } from "../scene/DioramaView";
import { AVAILABLE_STYLE_KITS } from "../scene/kitLoader";
import { Town } from "../scene/Town";
import { OVERVIEW_SHADOW_EXTENT, OVERVIEW_VIEW_HEIGHT, TOWN_SHADOW_EXTENT } from "../scene/townCamera";
import { dioramaStore, useDiorama } from "../state/dioramaStore";
import { PerfHud } from "../ui/PerfHud";

const panel: CSSProperties = {
  position: "fixed",
  left: 8,
  bottom: 8,
  display: "grid",
  gap: 6,
  maxWidth: 340,
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(255, 250, 240, 0.9)",
  color: "#3d3a44",
  font: "13px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
};


type Focus = "overview" | "spawn" | PlaceId;

const query = new URLSearchParams(window.location.search);
const s = dioramaStore.getState();
const initialStyle = query.get("style");
if (isStyleId(initialStyle)) s.setStyle(initialStyle);
const t = Number(query.get("t"));
if (query.has("t") && Number.isFinite(t)) s.setWorldTime(t);
if (query.get("speed") === "0") s.setTimeScale(0);
if (query.get("fx") === "0") s.setEffects(false);
if (query.has("zoom")) dioramaStore.setState({ zoomLevel: Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Number(query.get("zoom")) || 0)) });
if (query.has("step")) dioramaStore.setState({ cameraStep: Math.round(Number(query.get("step")) || 0) });
const places = townPlaces();
const initialFocus = query.get("focus");
const startFocus: Focus = initialFocus === "spawn" || (initialFocus !== null && initialFocus in places) ? (initialFocus as Focus) : "overview";

function focusPoint(focus: Focus): Vec2 {
  if (focus === "overview") return TOWN_CENTER;
  if (focus === "spawn") return SPAWN_POINT;
  return places[focus];
}

/** The walkability grid as a texture: blocked cells red, walkable cells clear. */
function navTexture(): DataTexture {
  const grid = townNavGrid();
  const data = new Uint8Array(grid.w * grid.d * 4);
  for (let j = 0; j < grid.d; j++) {
    for (let i = 0; i < grid.w; i++) {
      // Texture row 0 is the plane's bottom edge, which faces +z (south) after the plane is laid flat.
      const o = ((grid.d - 1 - j) * grid.w + i) * 4;
      const walk = grid.walk[j * grid.w + i] === 1;
      data.set(walk ? [90, 200, 120, 40] : [230, 70, 70, 150], o);
    }
  }
  const tex = new DataTexture(data, grid.w, grid.d, RGBAFormat);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function NavOverlay({ visible, onPick }: { visible: boolean; onPick: (p: Vec2) => void }) {
  const texture = useMemo(() => navTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh
      position={[TOWN_W / 2, 0.04, TOWN_D / 2]}
      rotation-x={-Math.PI / 2}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onPick([e.point.x, e.point.z]);
      }}
    >
      <planeGeometry args={[TOWN_W, TOWN_D]} />
      <meshBasicMaterial map={texture} transparent opacity={visible ? 1 : 0} depthWrite={false} />
    </mesh>
  );
}

function PathLine({ points }: { points: readonly Vec2[] }) {
  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points.flatMap(([x, z]) => [x, 0.12, z]), 3));
    return new Line(geometry, new LineBasicMaterial({ color: "#2b6fff" }));
  }, [points]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}

const pathLength = (p: readonly Vec2[]) => p.slice(1).reduce((n, q, k) => n + Math.hypot(q[0] - p[k]![0], q[1] - p[k]![1]), 0);

/**
 * Dev-only town page (`/dev/town`, build plan M11): the whole town in the active style with the
 * perf HUD, camera focus on any place (or the whole-town overview), the walkability grid overlay,
 * and click-to-path: a click on the ground runs A* from the spawn point. Query parameters:
 * `?focus=overview|spawn|<place>&style=european&nav=1&t=0.2&speed=0&zoom=1&step=0&fx=0`.
 */
export function TownView() {
  const style = useDiorama((st) => st.style);
  const zoomLevel = useDiorama((st) => st.zoomLevel);
  const { rotate, zoom, setStyle } = dioramaStore.getState();
  const [focus, setFocus] = useState<Focus>(startFocus);
  const [nav, setNav] = useState(query.get("nav") === "1");
  const [path, setPath] = useState<{ to: Vec2; points: Vec2[] | null } | null>(null);
  const [fx, fz] = focusPoint(focus);
  const overview = focus === "overview";

  const pick = (p: Vec2) => {
    const grid = townNavGrid();
    const to = nearestWalkable(grid, p, 2) ?? p;
    setPath({ to, points: findPath(grid, SPAWN_POINT, to) });
  };

  return (
    <DioramaView
      target={[fx, 0, fz]}
      viewHeight={overview ? OVERVIEW_VIEW_HEIGHT : undefined}
      shadowExtent={overview ? OVERVIEW_SHADOW_EXTENT : TOWN_SHADOW_EXTENT}
      world={
        <>
          <Town />
          <NavOverlay visible={nav} onPick={pick} />
          {path?.points ? <PathLine points={path.points} /> : null}
        </>
      }
    >
      <PerfHud />
      <div style={panel}>
        <strong>Town (M11)</strong>
        <label>
          focus{" "}
          <select value={focus} onChange={(e) => setFocus(e.target.value as Focus)}>
            <option value="overview">whole town</option>
            <option value="spawn">spawn point</option>
            {Object.keys(places).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          style{" "}
          <select value={style} onChange={(e) => isStyleId(e.target.value) && setStyle(e.target.value)}>
            {STYLE_IDS.map((id) => (
              <option key={id} value={id}>
                {STYLES[id].englishName}
                {AVAILABLE_STYLE_KITS.includes(id) ? "" : " (no kit yet)"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={nav} onChange={(e) => setNav(e.target.checked)} /> walkability grid (0.5 m)
        </label>
        <div>
          <button type="button" onClick={() => rotate(-1)} aria-label="Rotate left (Q)">
            ⟲ Q
          </button>{" "}
          <button type="button" onClick={() => rotate(1)} aria-label="Rotate right (E)">
            E ⟳
          </button>{" "}
          <button type="button" onClick={() => zoom(-1)} aria-label="Zoom in" disabled={overview}>
            +
          </button>{" "}
          <button type="button" onClick={() => zoom(1)} aria-label="Zoom out" disabled={overview}>
            −
          </button>{" "}
          zoom: {overview ? "overview" : ZOOM_LEVELS[zoomLevel]!.id}
        </div>
        <span>
          {path
            ? path.points
              ? `A* from spawn: ${path.points.length} waypoints, ${pathLength(path.points).toFixed(1)} m`
              : `no path to ${path.to.map((v) => v.toFixed(1)).join(", ")}`
            : "Click the ground to path there from the spawn point."}
        </span>
      </div>
    </DioramaView>
  );
}
