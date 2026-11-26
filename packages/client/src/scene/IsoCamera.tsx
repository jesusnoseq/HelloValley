import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { OrthographicCamera } from "three";
import { isAction, cameraEasing } from "../settings/settingsStore";
import { dioramaStore } from "../state/dioramaStore";
import { cameraRig, FOLLOW_DAMPING } from "./cameraRig";
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
const ORIGIN = [0, 0, 0] as const;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Drives the default orthographic camera: eases yaw towards the current 90° step and the zoom
 * towards the current level (or cuts there with reduced motion, M37), and binds Q/E (rotate,
 * remappable) and the scroll wheel (zoom).
 * When the player controller sets `cameraRig.follow`, the look-at point eases after the player
 * (or jumps there on `cameraRig.snap`); otherwise it is the fixed `target`. The eased target and
 * yaw are published on `cameraRig` for the lights and the interior cut-away. During an NPC
 * conversation `cameraRig.talk` takes over the target and zoom, eased the same way.
 */
export function IsoCamera({
  target = ORIGIN,
  viewHeight,
}: {
  target?: readonly [number, number, number];
  /** Overrides the zoom level's view height (whole-town dev overview). */
  viewHeight?: number;
}) {
  const domElement = useThree((s) => s.gl.domElement);
  const eased = useRef<{ yaw: number; viewHeight: number; x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    const { rotate } = dioramaStore.getState();
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      // Q/E by default; remappable in Settings (build plan M37).
      if (isAction(e, "rotateLeft")) rotate(-1);
      else if (isAction(e, "rotateRight")) rotate(1);
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
    // A conversation eases in on the pair (build plan M23); the zoom level comes back after it.
    const talk = cameraRig.talk;
    const targetHeight = talk?.viewHeight ?? viewHeight ?? ZOOM_LEVELS[zoomLevel]!.viewHeight;
    const focus = talk?.target ?? cameraRig.follow ?? target;
    const current = (eased.current ??= { yaw: targetYaw, viewHeight: targetHeight, x: focus[0], y: focus[1], z: focus[2] });
    // Reduced motion (build plan M37): no easing, the camera cuts to its new yaw, zoom and focus.
    const easing = cameraEasing();
    current.yaw = easing ? settle(damp(current.yaw, targetYaw, ROTATION_DAMPING, dt), targetYaw, 1e-4) : targetYaw;
    current.viewHeight = easing ? settle(dampLog(current.viewHeight, targetHeight, ZOOM_DAMPING, dt), targetHeight, 1e-3) : targetHeight;
    if ((talk || cameraRig.follow) && !cameraRig.snap && easing) {
      current.x = damp(current.x, focus[0], FOLLOW_DAMPING, dt);
      current.y = damp(current.y, focus[1], FOLLOW_DAMPING, dt);
      current.z = damp(current.z, focus[2], FOLLOW_DAMPING, dt);
    } else {
      [current.x, current.y, current.z] = focus;
      cameraRig.snap = false;
    }
    cameraRig.target = [current.x, current.y, current.z];
    cameraRig.yaw = current.yaw;

    const [ox, oy, oz] = cameraOffset(current.yaw, PITCH);
    camera.position.set(current.x + ox, current.y + oy, current.z + oz);
    camera.lookAt(current.x, current.y, current.z);
    const zoom = orthoZoom(current.viewHeight, state.size.height);
    if (camera.zoom !== zoom) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
