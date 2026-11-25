import type { CSSProperties, ReactNode } from "react";
import { formatCount } from "../scene/perfStats";
import { usePerf } from "../state/dioramaStore";

export const hudPanel: CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  padding: "6px 10px",
  borderRadius: 6,
  background: "rgba(20, 20, 24, 0.8)",
  color: "#f4f1ea",
  font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  pointerEvents: "none",
};

/** fps, worst frame, draw calls and triangles from the render loop (dev builds only). */
export function PerfStats() {
  const perf = usePerf();
  if (!import.meta.env.DEV || !perf) return null;
  const color = perf.fps >= 55 ? "#7fd18b" : perf.fps >= 40 ? "#e6c35c" : "#f08a7a";
  return (
    <div data-testid="perf-stats">
      <div>
        <span style={{ color }}>{perf.fps.toFixed(0)} fps</span> · worst {perf.worstMs.toFixed(1)} ms
      </div>
      <div>
        {formatCount(perf.calls)} draw calls · {formatCount(perf.triangles)} tris · dpr {perf.dpr}
      </div>
    </div>
  );
}

/** Standalone perf HUD for pages without the connection overlay. */
export function PerfHud({ children }: { children?: ReactNode }) {
  if (!import.meta.env.DEV) return null;
  return (
    <div style={hudPanel} data-testid="perf-hud">
      <PerfStats />
      {children}
    </div>
  );
}
