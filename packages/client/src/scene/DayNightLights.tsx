import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Color, type DirectionalLight, type HemisphereLight, SRGBColorSpace } from "three";
import { dioramaStore } from "../state/dioramaStore";
import { advanceWorldTime, lightingAt } from "./dayNight";
import { overcastColor } from "./weatherLook";
import { weatherRuntime } from "./worldFx";

/** Distance from the target to the key light. Shadows only need it outside the diorama. */
const KEY_DISTANCE = 40;
/** Half-size of the shadow camera in metres: covers the whole placeholder diorama. */
const SHADOW_EXTENT = 22;

/**
 * Warm key light with soft PCF shadows plus a hemisphere sky/ground fill, both following the
 * day/night gradient for the store's `worldTime`, dimmed and greyed by the current weather
 * (scene/Weather.tsx). Also paints the background colour and advances the local clock by
 * `timeScale`.
 */
export function DayNightLights({
  target = [0, 0, 0],
  shadowExtent = SHADOW_EXTENT,
}: {
  target?: readonly [number, number, number];
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
      f.color.setRGB(...overcastColor(light.skyColor, weather.overcast * 0.6), SRGBColorSpace);
      f.groundColor.setRGB(...light.groundColor, SRGBColorSpace);
      f.intensity = light.fillIntensity * weather.fillScale;
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
