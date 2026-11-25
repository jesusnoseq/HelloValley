import { type CSSProperties, useState } from "react";
import {
  BUILDING_RECIPE_IDS,
  type BuildingRecipe,
  type BuildingRecipeId,
  buildingRecipes,
  isStyleId,
  STYLE_IDS,
  STYLES,
} from "@hellovalley/shared";
import { ZOOM_LEVELS } from "../scene/cameraMath";
import { DioramaView } from "../scene/DioramaView";
import { KitBuilding } from "../scene/KitBuilding";
import { AVAILABLE_STYLE_KITS, resolveKitStyle } from "../scene/kitLoader";
import { dioramaStore, useDiorama } from "../state/dioramaStore";
import { PerfHud } from "../ui/PerfHud";

const panel: CSSProperties = {
  position: "fixed",
  left: 8,
  bottom: 8,
  display: "grid",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(255, 250, 240, 0.9)",
  color: "#3d3a44",
  font: "13px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
};

const PER_ROW = 5;
/** Slot spacing along a row and between rows, in metres. */
const PITCH_ROW = 10;
const PITCH_DEPTH = 13;

/**
 * Pivot positions that centre each building on its gallery slot (2 rows of 5), or one at the
 * origin. Rows run along the screen's horizontal at the default 45° camera yaw, so the far zoom
 * shows the whole gallery; buildings keep their front facing +Z.
 */
export function galleryLayout(recipes: readonly BuildingRecipe[]): { recipe: BuildingRecipe; position: [number, number, number] }[] {
  const rows = Math.ceil(recipes.length / PER_ROW);
  const s = Math.SQRT1_2;
  return recipes.map((recipe, i) => {
    const col = i % PER_ROW;
    const row = Math.floor(i / PER_ROW);
    const cols = Math.min(PER_ROW, recipes.length - row * PER_ROW);
    const along = (col - (cols - 1) / 2) * PITCH_ROW;
    const back = (row - (rows - 1) / 2) * PITCH_DEPTH;
    // Screen right is (1, 0, -1) / √2 and "away from the camera" is (-1, 0, -1) / √2.
    const cx = (along - back) * s;
    const cz = (-along - back) * s;
    return { recipe, position: [cx - recipe.footprint.w / 2, 0, cz + recipe.footprint.d / 2] };
  });
}

const query = new URLSearchParams(window.location.search);
const initialStyle = query.get("style");
if (isStyleId(initialStyle)) dioramaStore.getState().setStyle(initialStyle);
const t = Number(query.get("t"));
if (query.has("t") && Number.isFinite(t)) dioramaStore.getState().setWorldTime(t);
if (query.get("speed") === "0") dioramaStore.getState().setTimeScale(0);
if (query.get("fx") === "0") dioramaStore.getState().setEffects(false);
if (query.has("zoom")) dioramaStore.setState({ zoomLevel: Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Number(query.get("zoom")) || 0)) });
if (query.has("step")) dioramaStore.setState({ cameraStep: Math.round(Number(query.get("step")) || 0) });
const initialBuilding = query.get("b");

/**
 * Dev-only building gallery (`/dev/buildings`, build plan M10 acceptance): all 10 recipes
 * assembled from the active style kit, with a style switcher (the hook for the M32–M34 kits),
 * a single-building view and the M09 camera and lighting controls. Query parameters:
 * `?b=bakery&style=european&t=0.85&speed=0&zoom=1&step=0&fx=0`.
 */
export function BuildingGallery() {
  const style = useDiorama((s) => s.style);
  const zoomLevel = useDiorama((s) => s.zoomLevel);
  const worldTime = useDiorama((s) => s.worldTime);
  const { rotate, zoom, setStyle, setWorldTime } = dioramaStore.getState();
  const [only, setOnly] = useState<BuildingRecipeId | "all">(
    BUILDING_RECIPE_IDS.includes(initialBuilding as BuildingRecipeId) ? (initialBuilding as BuildingRecipeId) : "all",
  );

  const all = Object.values(buildingRecipes());
  const shown = only === "all" ? all : all.filter((r) => r.id === only);
  const layout = galleryLayout(shown);
  const kitStyle = resolveKitStyle(style);

  return (
    <DioramaView
      shadowExtent={only === "all" ? 34 : 14}
      world={
        <>
          <mesh position={[0, -0.05, 0]} receiveShadow>
            <boxGeometry args={[only === "all" ? 60 : 24, 0.1, only === "all" ? 60 : 24]} />
            <meshStandardMaterial color="#a9cf86" roughness={0.95} />
          </mesh>
          {layout.map(({ recipe, position }) => (
            <KitBuilding key={recipe.id} recipe={recipe} position={position} />
          ))}
        </>
      }
    >
      <PerfHud />
      <div style={panel}>
        <strong>Buildings (M10)</strong>
        <label>
          building{" "}
          <select value={only} onChange={(e) => setOnly(e.target.value as BuildingRecipeId | "all")}>
            <option value="all">all {all.length}</option>
            {all.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
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
        {kitStyle !== style ? <span>rendering with the {STYLES[kitStyle].englishName} kit</span> : null}
        <div>
          <button type="button" onClick={() => rotate(-1)} aria-label="Rotate left (Q)">
            ⟲ Q
          </button>{" "}
          <button type="button" onClick={() => rotate(1)} aria-label="Rotate right (E)">
            E ⟳
          </button>{" "}
          <button type="button" onClick={() => zoom(-1)} aria-label="Zoom in">
            +
          </button>{" "}
          <button type="button" onClick={() => zoom(1)} aria-label="Zoom out">
            −
          </button>{" "}
          zoom: {ZOOM_LEVELS[zoomLevel]!.id}
        </div>
        <label>
          worldTime {worldTime.toFixed(3)}{" "}
          <input type="range" min={0} max={1} step={0.001} value={worldTime} onChange={(e) => setWorldTime(Number(e.target.value))} />
        </label>
      </div>
    </DioramaView>
  );
}
