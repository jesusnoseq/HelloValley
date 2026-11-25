import { useFrame } from "@react-three/fiber";
import { dioramaStore } from "../state/dioramaStore";
import { lightingAt } from "./dayNight";
import { kitGlow, type KitLoader, kitLoader } from "./kitLoader";

/**
 * Drives the shared `glow` (lamp lanterns) and `glass` (windows) materials of every loaded kit
 * from the day/night gradient. One material per kit and slot, so this is a few writes a frame.
 */
export function KitLighting({ loader = kitLoader }: { loader?: KitLoader }) {
  useFrame(() => {
    const { lamp, window } = kitGlow(lightingAt(dioramaStore.getState().worldTime).nightGlow);
    for (const kit of loader.loaded()) {
      kit.materials.glow.emissiveIntensity = lamp;
      kit.materials.glass.emissiveIntensity = window;
    }
  });
  return null;
}
