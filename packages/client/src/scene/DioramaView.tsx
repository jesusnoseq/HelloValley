import { lazy, type ReactNode, Suspense } from "react";
import type { DioramaCanvasProps } from "./DioramaCanvas";

// three.js, R3F, drei and postprocessing load in their own chunk, after sign-in.
const DioramaCanvas = lazy(() => import("./DioramaCanvas"));

/**
 * Full-window diorama behind the UI. `world` is the scene content (the M09 placeholder blocks
 * when omitted); `children` overlay the canvas.
 */
export function DioramaView({
  children,
  world,
  ...canvas
}: { children?: ReactNode; world?: ReactNode } & Omit<DioramaCanvasProps, "children">) {
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
      {children}
    </div>
  );
}
