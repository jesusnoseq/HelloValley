import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { perfStore } from "../state/dioramaStore";
import { FpsMeter } from "./perfStats";

/**
 * Dev-only: samples fps, draw calls and triangles for the perf HUD. The effect composer renders
 * several passes per frame, so `renderer.info` stops auto-resetting per render and is read and
 * reset here, first thing each frame, covering every pass of the previous frame.
 */
export function PerfProbe() {
  const get = useThree((s) => s.get);
  const meter = useRef(new FpsMeter());

  useEffect(
    () => () => {
      get().gl.info.autoReset = true;
      perfStore.setState(null, true);
    },
    [get],
  );

  useFrame((state, dt) => {
    const { info } = state.gl;
    info.autoReset = false;
    const { calls, triangles } = info.render;
    info.reset();
    const sample = meter.current.tick(dt);
    if (sample) perfStore.setState({ ...sample, calls, triangles, dpr: state.viewport.dpr }, true);
  }, -1000);

  return null;
}
