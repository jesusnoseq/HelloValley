import { Canvas, useFrame } from "@react-three/fiber";
import { ANIMAL_IDS } from "@hellovalley/shared";
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { assembleCharacter, type CharacterAssets, loadCharacterAssets } from "../../characters/characterGlb";
import { useI18n } from "../../i18n/I18nProvider";

/**
 * The live 3D preview of character creation (build plan M14): the generated body with the chosen
 * animal head, tinted fur, shirt and trousers, idling on a slow turntable. Loaded lazily so
 * three.js and R3F stay out of the onboarding chunk until it renders.
 * TODO(M15): reuse for the apartment mirror, with the full animation state machine.
 */

export interface PreviewLook {
  animal: string;
  fur: string;
  furHex: string;
  shirtHex: string;
  trousersHex: string;
}

let assetsPromise: Promise<CharacterAssets> | null = null;

/** Body plus all 16 animals (each 8–25 kB), so the carousel swaps heads instantly. */
function previewAssets(): Promise<CharacterAssets> {
  assetsPromise ??= loadCharacterAssets(`${import.meta.env.BASE_URL}assets/characters`, {
    animals: ANIMAL_IDS,
    outfits: [],
  });
  assetsPromise.catch(() => {
    assetsPromise = null;
  });
  return assetsPromise;
}

function Avatar({ assets, look }: { assets: CharacterAssets; look: PreviewLook }) {
  const turntable = useRef<Group>(null);
  // A new character per animal; tints change in place. The fur id only seeds the assembly.
  const character = useMemo(
    () => assembleCharacter(assets, { animal: look.animal, furTint: look.fur, shirt: "sky", trousers: "navy" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, look.animal],
  );
  useEffect(() => {
    character.play("idle", 0);
    return () => {
      character.mixer.stopAllAction();
    };
  }, [character]);
  useEffect(() => {
    character.setTint("fur", look.furHex);
    character.setTint("shirt", look.shirtHex);
    character.setTint("trousers", look.trousersHex);
  }, [character, look.furHex, look.shirtHex, look.trousersHex]);
  useFrame(({ clock }, dt) => {
    character.mixer.update(Math.min(dt, 0.1));
    // A gentle turntable sway that keeps the face towards the camera.
    if (turntable.current) turntable.current.rotation.y = Math.sin(clock.elapsedTime * 0.6) * 0.6;
  });
  return (
    <group ref={turntable}>
      <primitive object={character.root} />
    </group>
  );
}

class PreviewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.error("character preview:", error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function CharacterPreview({ look }: { look: PreviewLook }) {
  const { t } = useI18n();
  const [assets, setAssets] = useState<CharacterAssets | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    previewAssets().then(
      (a) => {
        if (!cancelled) setAssets(a);
      },
      (error: unknown) => {
        console.error("character preview assets:", error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const unavailable = <p className="hv-onb-stage-msg">{t("onboarding.preview.unavailable")}</p>;
  if (failed) return unavailable;
  return (
    <PreviewBoundary fallback={unavailable}>
      {assets ? null : <p className="hv-onb-stage-msg">{t("onboarding.preview.loading")}</p>}
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.8, 3.1], fov: 30, near: 0.1, far: 20 }}
        onCreated={({ camera }) => camera.lookAt(0, 0.6, 0)}
        style={{ position: "absolute", inset: 0 }}
        aria-hidden="true"
      >
        <hemisphereLight args={["#fff6e8", "#a8b89a", 1.6]} />
        <directionalLight position={[-2, 4, 3]} intensity={2.2} color="#fff1dc" />
        {assets ? <Avatar assets={assets} look={look} /> : null}
      </Canvas>
    </PreviewBoundary>
  );
}
