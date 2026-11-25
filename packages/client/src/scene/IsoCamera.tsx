import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { OrthographicCamera } from "three";
import { dioramaStore } from "../state/dioramaStore";
import {
  cameraOffset,
  CAMERA_PITCH_DEG,
  damp,
  dampLog,
  degToRad,
  orthoZoom,
  ROTATION_DAMPING,
  settle,
  WheelStepper,
  yawForStep,
  ZOOM_DAMPING,
  ZOOM_LEVELS,
} from "./cameraMath";

const PITCH = degToRad(CAMERA_PITCH_DEG);

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Drives the default orthographic camera: eases yaw towards the current 90° step and the zoom
 * towards the current level, and binds Q/E (rotate) and the scroll wheel (zoom).
 * TODO(M13): follow the local player instead of a fixed target.
 */
export function IsoCamera({ target = [0, 0, 0] }: { target?: readonly [number, number, number] }) {
  const domElement = useThree((s) => s.gl.domElement);
  const eased = useRef<{ yaw: number; viewHeight: number } | null>(null);

  useEffect(() => {
    const { rotate } = dioramaStore.getState();
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "q") rotate(-1);
      else if (key === "e") rotate(1);
    };
    const stepper = new WheelStepper();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Line/page delta modes (Firefox) report small numbers; scale them to pixels.
      const delta = e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
      const direction = stepper.push(delta, e.timeStamp / 1000);
      if (direction !== 0) dioramaStore.getState().zoom(direction);
    };
    window.addEventListener("keydown", onKey);
    domElement.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      domElement.removeEventListener("wheel", onWheel);
    };
  }, [domElement]);

  useFrame((state, dt) => {
    const camera = state.camera as OrthographicCamera;
    const { cameraStep, zoomLevel } = dioramaStore.getState();
    const targetYaw = yawForStep(cameraStep);
    const targetHeight = ZOOM_LEVELS[zoomLevel]!.viewHeight;
    const current = (eased.current ??= { yaw: targetYaw, viewHeight: targetHeight });
    current.yaw = settle(damp(current.yaw, targetYaw, ROTATION_DAMPING, dt), targetYaw, 1e-4);
    current.viewHeight = settle(dampLog(current.viewHeight, targetHeight, ZOOM_DAMPING, dt), targetHeight, 1e-3);

    const [ox, oy, oz] = cameraOffset(current.yaw, PITCH);
    camera.position.set(target[0] + ox, target[1] + oy, target[2] + oz);
    camera.lookAt(target[0], target[1], target[2]);
    const zoom = orthoZoom(current.viewHeight, state.size.height);
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
