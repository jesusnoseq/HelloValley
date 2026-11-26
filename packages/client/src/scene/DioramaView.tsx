import { lazy, type ReactNode, Suspense } from "react";
import { trackLoad } from "../assets/loadProgress";
import { LoadingScreen } from "../ui/loading/LoadingScreen";
import type { DioramaCanvasProps } from "./DioramaCanvas";

// three.js, R3F, drei and postprocessing load in their own chunk, after sign-in (counted by the
// preloading screen, build plan M37).
const DioramaCanvas = lazy(() => trackLoad(import("./DioramaCanvas")));

/**
 * Full-window diorama behind the UI. `world` is the scene content (the M09 placeholder blocks
 * when omitted); `children` overlay the canvas.
 */
export function DioramaView({
  children,
  world,
  loading,
  ...canvas
}: {
  children?: ReactNode;
  world?: ReactNode;
  /** Show the preloading screen with tips in this target language (the game; dev pages omit it). */
  loading?: { targetLang: string | null };
} & Omit<DioramaCanvasProps, "children">) {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#d6eaf5" }}>
      <Suspense
        fallback={
          <p role="status" style={{ font: "16px system-ui, sans-serif", padding: 24, margin: 0 }}>
            Loading the town…
          </p>
        }
      >
        <DioramaCanvas {...canvas}>{world}</DioramaCanvas>
      </Suspense>
      {/* The HUD layer, scaled by the text size setting (ui/theme.css, M37). */}
      <div className="hv-ui">{children}</div>
      {loading ? <LoadingScreen targetLang={loading.targetLang} /> : null}
    </div>
  );
}
