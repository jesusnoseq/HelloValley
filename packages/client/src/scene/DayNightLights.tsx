import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Color, type DirectionalLight, type HemisphereLight, SRGBColorSpace } from "three";
import { dioramaStore } from "../state/dioramaStore";
import { advanceWorldTime, lightingAt } from "./dayNight";

/** Distance from the target to the key light. Shadows only need it outside the diorama. */
const KEY_DISTANCE = 40;
/** Half-size of the shadow camera in metres: covers the whole placeholder diorama. */
const SHADOW_EXTENT = 22;

/**
 * Warm key light with soft PCF shadows plus a hemisphere sky/ground fill, both following the
 * day/night gradient for the store's `worldTime`. Also paints the background colour and advances
 * the local clock by `timeScale`.
 */
export function DayNightLights({ target = [0, 0, 0] }: { target?: readonly [number, number, number] }) {
  const key = useRef<DirectionalLight>(null);
  const fill = useRef<HemisphereLight>(null);
  const background = useRef(new Color());

  useFrame((state, dt) => {
    const store = dioramaStore.getState();
    // TODO(M16): take worldTime from the TownRoom clock instead of ticking it locally.
    if (store.timeScale > 0) store.setWorldTime(advanceWorldTime(store.worldTime, dt, store.timeScale));
    const light = lightingAt(dioramaStore.getState().worldTime);

    const k = key.current;
    if (k) {
      const [dx, dy, dz] = light.keyDirection;
      k.position.set(target[0] + dx * KEY_DISTANCE, target[1] + dy * KEY_DISTANCE, target[2] + dz * KEY_DISTANCE);
      k.target.position.set(target[0], target[1], target[2]);
      k.target.updateMatrixWorld();
      k.color.setRGB(...light.keyColor, SRGBColorSpace);
      k.intensity = light.keyIntensity;
    }
    const f = fill.current;
    if (f) {
      f.color.setRGB(...light.skyColor, SRGBColorSpace);
      f.groundColor.setRGB(...light.groundColor, SRGBColorSpace);
      f.intensity = light.fillIntensity;
    }
    background.current.setRGB(...light.background, SRGBColorSpace);
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
          args={[-SHADOW_EXTENT, SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, 1, KEY_DISTANCE * 2]}
        />
      </directionalLight>
    </>
  );
}
