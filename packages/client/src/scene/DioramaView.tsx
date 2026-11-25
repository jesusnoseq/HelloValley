import { lazy, type ReactNode, Suspense } from "react";

// three.js, R3F, drei and postprocessing load in their own chunk, after sign-in.
const DioramaCanvas = lazy(() => import("./DioramaCanvas"));

/** Full-window diorama behind the UI. `children` overlay the canvas. */
export function DioramaView({ children }: { children?: ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#d6eaf5" }}>
      <Suspense
        fallback={
          <p role="status" style={{ font: "16px system-ui, sans-serif", padding: 24, margin: 0 }}>
            Loading the town…
          </p>
        }
      >
        <DioramaCanvas />
      </Suspense>
      {children}
    </div>
  );
}
