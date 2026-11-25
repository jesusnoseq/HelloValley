import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ANIMALS, CHARACTER_ANIMATIONS, NPCS, PALETTE, type SwatchId } from "@hellovalley/shared";
import { assembleCharacter, type Character, loadCharacterAssets } from "../characters/characterGlb";

/**
 * Dev-only character gallery (`/dev/characters`, build plan M07 acceptance): every animal and
 * every NPC in its outfit, playing the chosen clip (or cycling through all 14), with tintable
 * shirt, trousers and fur. Plain three.js: the R3F scene arrives in M09. Not in production
 * builds (main.tsx only imports it when `import.meta.env.DEV`).
 */

type ClipChoice = (typeof CHARACTER_ANIMATIONS)[number] | "cycle";

interface Entry {
  character: Character;
  animal: (typeof ANIMALS)[number];
  npc: boolean;
}

const CYCLE_SECONDS = 2.5;
const SPACING = 1.1;

export function CharacterGallery() {
  const mount = useRef<HTMLDivElement>(null);
  const entries = useRef<Entry[]>([]);
  const [status, setStatus] = useState("loading characters...");
  const [clip, setClip] = useState<ClipChoice>("cycle");
  const [shirt, setShirt] = useState<SwatchId>("sky");
  const [trousers, setTrousers] = useState<SwatchId>("navy");
  const [furIndex, setFurIndex] = useState(0);
  const [optional, setOptional] = useState(false);
  const clipRef = useRef<ClipChoice>(clip);

  useEffect(() => {
    clipRef.current = clip;
    for (const [i, e] of entries.current.entries()) {
      e.character.play(clip === "cycle" ? CHARACTER_ANIMATIONS[i % CHARACTER_ANIMATIONS.length]! : clip);
    }
  }, [clip, status]);

  useEffect(() => {
    const shirtHex = PALETTE.find((s) => s.id === shirt)!.hex;
    const trousersHex = PALETTE.find((s) => s.id === trousers)!.hex;
    for (const e of entries.current) {
      if (e.npc) continue;
      e.character.setTint("shirt", shirtHex);
      e.character.setTint("trousers", trousersHex);
      e.character.setTint("fur", e.animal.furTints[furIndex % e.animal.furTints.length]!.hex);
    }
  }, [shirt, trousers, furIndex, status]);

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.background = new Color("#e9e4d8");
    scene.add(new HemisphereLight("#fff6e8", "#a8b89a", 1.4), new AmbientLight("#ffffff", 0.3));
    const sun = new DirectionalLight("#fff1dc", 2.2);
    sun.position.set(-6, 10, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    scene.add(sun);
    const ground = new Mesh(new PlaneGeometry(40, 40), new MeshStandardMaterial({ color: "#c9d3b8", roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    // The game camera (GDD §7.1): 35 degrees pitch, 45 degrees yaw.
    camera.position.set(20, 20 * Math.tan((35 * Math.PI) / 180) * Math.SQRT2, 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, 0);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      const half = 6.5;
      camera.left = (-half * w) / h;
      camera.right = (half * w) / h;
      camera.top = half;
      camera.bottom = -half;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    let disposed = false;
    loadCharacterAssets(`${import.meta.env.BASE_URL}assets/characters`)
      .then((assets) => {
        if (disposed) return;
        const list: Entry[] = [];
        ANIMALS.forEach((animal, i) => {
          const character = assembleCharacter(assets, { animal: animal.id, furTint: animal.furTints[0].id, shirt: "sky", trousers: "navy" });
          character.root.position.set(((i % 4) - 1.5) * SPACING - 2.2, 0, (Math.floor(i / 4) - 1.5) * SPACING);
          list.push({ character, animal, npc: false });
        });
        NPCS.forEach((npc, i) => {
          const character = assembleCharacter(assets, { ...npc.look, outfit: npc.id });
          character.root.position.set(((i % 3) - 1) * SPACING + 3.2, 0, (Math.floor(i / 3) - 1) * SPACING);
          list.push({ character, animal: ANIMALS.find((a) => a.id === npc.look.animal)!, npc: true });
        });
        for (const e of list) {
          e.character.root.traverse((n) => {
            n.castShadow = true;
          });
          scene.add(e.character.root);
        }
        entries.current = list;
        setStatus(`${list.length} characters, ${assets.body.animations.length} clips`);
      })
      .catch((err: unknown) => setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`));

    const clock = new Clock();
    let cycleTime = 0;
    let cycleStep = 0;
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta();
      if (clipRef.current === "cycle") {
        cycleTime += dt;
        if (cycleTime > CYCLE_SECONDS) {
          cycleTime = 0;
          cycleStep++;
          for (const [i, e] of entries.current.entries()) e.character.play(CHARACTER_ANIMATIONS[(i + cycleStep) % CHARACTER_ANIMATIONS.length]!);
        }
      }
      for (const e of entries.current) e.character.mixer.update(dt);
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      entries.current = [];
    };
  }, []);

  useEffect(() => {
    // Optional parts: show the ones that are hidden by default (floppy ears replace upright
    // ones, a tabby pattern, the capybara's orange, penguin flippers) and hide antlers.
    for (const e of entries.current) {
      if (e.npc) continue;
      for (const [name, node] of e.character.parts) {
        const byDefault = node.userData.hv_default !== false;
        if (name === "ears_upright" || name === "antlers") e.character.setPartVisible(name, !optional);
        else if (!byDefault) e.character.setPartVisible(name, optional);
      }
    }
  }, [optional, status]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", padding: 8, background: "#f6efdc" }}>
        <strong>Characters (dev)</strong>
        <label>
          Clip{" "}
          <select value={clip} onChange={(e) => setClip(e.target.value as ClipChoice)}>
            <option value="cycle">cycle all</option>
            {CHARACTER_ANIMATIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Shirt{" "}
          <select value={shirt} onChange={(e) => setShirt(e.target.value as SwatchId)}>
            {PALETTE.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trousers{" "}
          <select value={trousers} onChange={(e) => setTrousers(e.target.value as SwatchId)}>
            {PALETTE.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setFurIndex((i) => i + 1)}>
          Next fur tint
        </button>
        <label>
          <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /> Optional parts
        </label>
        <span aria-live="polite">{status}</span>
        <span style={{ opacity: 0.7 }}>Left: the 16 animals (tinted by the controls). Right: the 9 NPCs in their outfits.</span>
      </div>
      <div ref={mount} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
