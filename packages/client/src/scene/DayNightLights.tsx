import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Color, type DirectionalLight, type HemisphereLight, SRGBColorSpace } from "three";
import { dioramaStore } from "../state/dioramaStore";
import { worldStore } from "../state/worldStore";
import { cameraRig, snapToGrid } from "./cameraRig";
import { advanceWorldTime, lightingAt } from "./dayNight";
import { overcastColor } from "./weatherLook";
import { weatherRuntime } from "./worldFx";

/** Distance from the target to the key light. Shadows only need it outside the diorama. */
const KEY_DISTANCE = 40;
/** Half-size of the shadow camera in metres: covers the whole placeholder diorama. */
const SHADOW_EXTENT = 22;
/** Indoors the hemisphere fill never drops below this, and warms towards lamp light at night. */
export const INDOOR_FILL_MIN = 1.1;
const LAMP_LIGHT: [number, number, number] = [1, 0.8, 0.58];

/**
 * Warm key light with soft PCF shadows plus a hemisphere sky/ground fill, both following the
 * day/night gradient for the store's `worldTime`, dimmed and greyed by the current weather
 * (scene/Weather.tsx). Also paints the background colour and advances the local clock by
 * `timeScale`. The lights centre on the camera's eased look-at point (snapped to a 1 m grid so
 * shadows do not shimmer while the camera follows the player); indoors (build plan M13) the
 * fill is raised and warmed at night, as if the room's lamps were on.
 */
export function DayNightLights({
  shadowExtent = SHADOW_EXTENT,
}: {
  /** Half-size of the shadow camera in metres. */
  shadowExtent?: number;
}) {
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<HemisphereLight>(null);
  const background = useRef(new Color());

  useFrame((state, dt) => {
    const store = dioramaStore.getState();
    // TODO(M16): take worldTime from the TownRoom clock instead of ticking it locally.
    if (store.timeScale > 0) store.setWorldTime(advanceWorldTime(store.worldTime, dt, store.timeScale));
    const light = lightingAt(dioramaStore.getState().worldTime);
    const weather = weatherRuntime.look;
    const indoors = worldStore.getState().space !== "town";
    const target = [snapToGrid(cameraRig.target[0]), cameraRig.target[1], snapToGrid(cameraRig.target[2])] as const;

    const k = key.current;
    if (k) {
      const [dx, dy, dz] = light.keyDirection;
      k.position.set(target[0] + dx * KEY_DISTANCE, target[1] + dy * KEY_DISTANCE, target[2] + dz * KEY_DISTANCE);
      k.target.position.set(target[0], target[1], target[2]);
      k.target.updateMatrixWorld();
      k.color.setRGB(...light.keyColor, SRGBColorSpace);
      k.intensity = light.keyIntensity * weather.keyScale;
    }
    const f = fill.current;
    if (f) {
      const sky = overcastColor(light.skyColor, weather.overcast * 0.6);
      const warm = indoors ? light.nightGlow : 0;
      f.color.setRGB(...(sky.map((c, k) => c + (LAMP_LIGHT[k]! - c) * warm) as [number, number, number]), SRGBColorSpace);
      f.groundColor.setRGB(...light.groundColor, SRGBColorSpace);
      const fill = light.fillIntensity * weather.fillScale;
      f.intensity = indoors ? Math.max(fill, INDOOR_FILL_MIN) : fill;
    }
    background.current.setRGB(...overcastColor(light.background, weather.overcast), SRGBColorSpace);
    state.scene.background = background.current;
  });

  return (
    <>
      <hemisphereLight ref={fill} />
      <directionalLight
        ref={key}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={4}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-shadowExtent, shadowExtent, shadowExtent, -shadowExtent, 1, KEY_DISTANCE * 2]}
        />
      </directionalLight>
    </>
  );
}
