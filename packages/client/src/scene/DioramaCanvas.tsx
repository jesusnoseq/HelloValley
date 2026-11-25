import { PerformanceMonitor } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { type ReactNode, useState } from "react";
import { dioramaStore } from "../state/dioramaStore";
import { CAMERA_FAR, CAMERA_NEAR, cameraOffset, CAMERA_PITCH_DEG, degToRad, yawForStep } from "./cameraMath";
import { DayNightLights } from "./DayNightLights";
import { DioramaEffects } from "./DioramaEffects";
import { IsoCamera } from "./IsoCamera";
import { KitLighting } from "./KitLighting";
import { dprForFactor } from "./perfStats";
import { PerfProbe } from "./PerfProbe";
import { TestBlocks } from "./TestBlocks";

export interface DioramaCanvasProps {
  children?: ReactNode;
  /** Half-size of the key light's shadow camera in metres. */
  shadowExtent?: number;
  /** Camera look-at point and light centre (default: the origin). TODO(M13): follow the player. */
  target?: readonly [number, number, number];
  /** Override the zoom level's view height in metres (dev overviews). */
  viewHeight?: number;
}

const initialPosition = cameraOffset(yawForStep(dioramaStore.getState().cameraStep), degToRad(CAMERA_PITCH_DEG));

/**
 * The R3F diorama (GDD §7.1): orthographic isometric camera, day/night lights with soft shadows
 * and the post-processing stack. Loaded lazily (see DioramaView) so three.js, R3F and
 * postprocessing stay out of the entry chunk. `children` is the world; it defaults to the M09
 * placeholder blocks. The resolution drops towards dpr 1 when frames fall below 50 fps.
 */
export default function DioramaCanvas({ children, shadowExtent, target, viewHeight }: DioramaCanvasProps) {
  const deviceRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const [dpr, setDpr] = useState(() => dprForFactor(1, deviceRatio));
  return (
    <Canvas
      orthographic
      // PCFSoftShadowMap is removed in three r18x; PCF with `shadow.radius` gives the soft edge.
      shadows="percentage"
      dpr={dpr}
      // The composer does its own MSAA, so the default framebuffer needs none.
      gl={{ antialias: false, stencil: false, powerPreference: "high-performance" }}
      camera={{ position: initialPosition, near: CAMERA_NEAR, far: CAMERA_FAR }}
      style={{ position: "absolute", inset: 0 }}
    >
      <PerformanceMonitor factor={1} onChange={({ factor }) => setDpr(dprForFactor(factor, deviceRatio))} />
      <IsoCamera target={target} viewHeight={viewHeight} />
      <DayNightLights target={target} shadowExtent={shadowExtent} />
      <KitLighting />
      {children ?? <TestBlocks />}
      <DioramaEffects />
      {import.meta.env.DEV ? <PerfProbe /> : null}
    </Canvas>
  );
}
