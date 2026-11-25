import type { CSSProperties } from "react";
import { ZOOM_LEVELS } from "../scene/cameraMath";
import { DioramaView } from "../scene/DioramaView";
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

const SPEEDS = [0, 1, 20, 120] as const;

/**
 * Optional query parameters for repeatable views (screenshots, perf comparisons):
 * `?t=0.875&speed=0&step=1&zoom=0&fx=0&tilt=0`.
 */
function applyQuery(search: string) {
  const q = new URLSearchParams(search);
  const num = (key: string) => (q.has(key) && Number.isFinite(Number(q.get(key))) ? Number(q.get(key)) : undefined);
  const s = dioramaStore.getState();
  const t = num("t");
  if (t !== undefined) s.setWorldTime(t);
  const speed = num("speed");
  if (speed !== undefined) s.setTimeScale(speed);
  const step = num("step");
  if (step !== undefined) dioramaStore.setState({ cameraStep: Math.round(step) });
  const zoom = num("zoom");
  if (zoom !== undefined) {
    dioramaStore.setState({ zoomLevel: Math.min(ZOOM_LEVELS.length - 1, Math.max(0, Math.round(zoom))) });
  }
  if (q.get("fx") === "0") s.setEffects(false);
  if (q.get("tilt") === "0") s.setTiltShift(false);
}
applyQuery(window.location.search);

/**
 * Dev-only diorama test page (`/dev/diorama`, build plan M09 acceptance): the placeholder scene
 * with the perf HUD and controls for rotation, zoom, worldTime and the effects. No sign-in.
 */
export function DioramaSandbox() {
  const worldTime = useDiorama((s) => s.worldTime);
  const timeScale = useDiorama((s) => s.timeScale);
  const zoomLevel = useDiorama((s) => s.zoomLevel);
  const tiltShift = useDiorama((s) => s.tiltShift);
  const effects = useDiorama((s) => s.effects);
  const { rotate, zoom, setWorldTime, setTimeScale, setTiltShift, setEffects } = dioramaStore.getState();

  return (
    <DioramaView>
      <PerfHud />
      <div style={panel}>
        <strong>Diorama (M09)</strong>
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
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={worldTime}
            onChange={(e) => setWorldTime(Number(e.target.value))}
          />
        </label>
        <label>
          clock speed{" "}
          <select value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "paused" : `${s}×`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={effects} onChange={(e) => setEffects(e.target.checked)} /> post-processing
        </label>
        <label>
          <input
            type="checkbox"
            checked={tiltShift}
            disabled={!effects}
            onChange={(e) => setTiltShift(e.target.checked)}
          />{" "}
          tilt-shift
        </label>
      </div>
    </DioramaView>
  );
}
