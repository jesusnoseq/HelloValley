import { Bloom, EffectComposer, N8AO, TiltShift2, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useDiorama } from "../state/dioramaStore";

/**
 * Post-processing for the miniature look (GDD §7.1): N8AO ambient occlusion, a light bloom that
 * only catches emissive lamps (threshold 1), an optional tilt-shift blur band and ACES tone mapping
 * (the composer renders to float targets, so the renderer's own tone mapping does not apply).
 * Settings lean towards integrated GPUs: half-resolution AO and the "performance" preset.
 * TODO(M37): tune against real frame times and add a quality setting.
 */
export function DioramaEffects() {
  const enabled = useDiorama((s) => s.effects);
  const tiltShift = useDiorama((s) => s.tiltShift);
  if (!enabled) return null;
  return (
    <EffectComposer multisampling={4} stencilBuffer={false}>
      <N8AO
        aoRadius={1.6}
        distanceFalloff={0.6}
        intensity={2.2}
        color="#3a2a40"
        quality="performance"
        halfRes
      />
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.7} radius={0.7} />
      {tiltShift ? <TiltShift2 blur={0.12} taper={0.6} samples={8} /> : null}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
