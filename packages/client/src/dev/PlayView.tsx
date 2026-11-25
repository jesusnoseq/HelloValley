import type { CSSProperties } from "react";
import { BUILDING_RECIPE_IDS, buildingExitPoint, interiorArrivalPoint, isInteriorId, type SpacePoint } from "@hellovalley/shared";
import { ZOOM_LEVELS } from "../scene/cameraMath";
import { DioramaView } from "../scene/DioramaView";
import { TOWN_SHADOW_EXTENT } from "../scene/townCamera";
import { TOWN_START, World } from "../scene/World";
import { dioramaStore, useDiorama } from "../state/dioramaStore";
import { useWorld } from "../state/worldStore";
import { FadeOverlay } from "../ui/FadeOverlay";
import { PerfHud } from "../ui/PerfHud";

const panel: CSSProperties = {
  position: "fixed",
  left: 8,
  bottom: 8,
  display: "grid",
  gap: 6,
  maxWidth: 360,
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(255, 250, 240, 0.9)",
  color: "#3d3a44",
  font: "13px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
};

const query = new URLSearchParams(window.location.search);
const s = dioramaStore.getState();
const t = Number(query.get("t"));
if (query.has("t") && Number.isFinite(t)) s.setWorldTime(t);
if (query.get("speed") === "0") s.setTimeScale(0);
if (query.get("fx") === "0") s.setEffects(false);
if (query.has("zoom")) dioramaStore.setState({ zoomLevel: Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Number(query.get("zoom")) || 0)) });
if (query.has("step")) dioramaStore.setState({ cameraStep: Math.round(Number(query.get("step")) || 0) });

/** `?space=<interior>` starts inside it, `?at=<building>` outside its door, else at the spawn point. */
function startPoint(): SpacePoint {
  const space = query.get("space");
  if (isInteriorId(space)) return interiorArrivalPoint(space);
  const at = query.get("at");
  if (at && (BUILDING_RECIPE_IDS as readonly string[]).includes(at)) return buildingExitPoint(at as (typeof BUILDING_RECIPE_IDS)[number]);
  return TOWN_START;
}

const START = startPoint();

/**
 * Dev-only play page (`/dev/play`, build plan M13): the world with the local player and no
 * sign-in. WASD / arrows walk (Shift runs), click the ground to walk there, click a building or
 * walk into its door to go inside; Q/E rotate, the wheel zooms. Query parameters:
 * `?space=bakery` or `?at=library` (start point), `&t=0.2&speed=0&zoom=1&step=0&fx=0`.
 */
export function PlayView() {
  const space = useWorld((st) => st.space);
  const zoomLevel = useDiorama((st) => st.zoomLevel);
  return (
    <DioramaView shadowExtent={TOWN_SHADOW_EXTENT} world={<World start={START} />}>
      <FadeOverlay />
      <PerfHud />
      <div style={panel}>
        <strong>Play (M13)</strong>
        <span>
          space: {space} · zoom: {ZOOM_LEVELS[zoomLevel]!.id}
        </span>
        <span>WASD / arrows walk, Shift runs, click to walk there, click a building or walk into its door to enter. Q/E rotate, wheel zooms.</span>
      </div>
    </DioramaView>
  );
}
