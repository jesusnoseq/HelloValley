import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Group, type Mesh, MeshBasicMaterial, Raycaster, RingGeometry, Vector2 } from "three";
import { type CharacterLook, PlayerController, type SpacePoint, type Vec2 } from "@hellovalley/shared";
import { assembleCharacter, type Character, type CharacterAssets, loadCharacterAssets } from "../characters/characterGlb";
import { PLACEHOLDER_LOOK } from "../characters/placeholderLook";
import { dioramaStore } from "../state/dioramaStore";
import { worldStore } from "../state/worldStore";
import { yawForStep } from "./cameraMath";
import { cameraRig } from "./cameraRig";
import { dampAngle, type Fade, IDLE_FADE, RUN_KEYS, screenDirection, screenToWorld, startFade, stepFade } from "./playerMath";

/** Turning speed of the avatar towards its walking direction (1/s). */
const TURN_RATE = 14;

let assetsPromise: Promise<CharacterAssets> | null = null;

/** The character assets the placeholder needs (body + one animal), loaded once per page. */
function placeholderAssets(): Promise<CharacterAssets> {
  assetsPromise ??= loadCharacterAssets(`${import.meta.env.BASE_URL}assets/characters`, { animals: [PLACEHOLDER_LOOK.animal], outfits: [] });
  assetsPromise.catch(() => {
    assetsPromise = null;
  });
  return assetsPromise;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The local player (build plan M13): WASD / arrows walk relative to the screen (Shift runs),
 * a left click on the ground walks there along an A* path, and walking into a door fades into
 * that building's interior (or back out). The camera follows through `cameraRig`. Movement is
 * local only: TODO(M16) send inputs to the TownRoom and reconcile with its authoritative positions.
 */
export function Player({ start, look = PLACEHOLDER_LOOK }: { start: SpacePoint; look?: CharacterLook }) {
  const controller = useMemo(() => new PlayerController(start), [start]);
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const held = useRef(new Set<string>());
  const avatar = useRef<Group>(null);
  const marker = useRef<Mesh>(null);
  const fade = useRef<Fade>(IDLE_FADE);
  const heading = useRef(start.heading);
  const [character, setCharacter] = useState<Character | null>(null);

  // Show the start space and put the camera on the player.
  useEffect(() => {
    worldStore.getState().setSpace(start.space);
    cameraRig.follow = [start.pos[0], 0, start.pos[1]];
    cameraRig.snap = true;
    return () => {
      cameraRig.follow = null;
    };
  }, [start]);

  useEffect(() => {
    let cancelled = false;
    let built: Character | null = null;
    placeholderAssets()
      .then((assets) => {
        if (cancelled) return;
        built = assembleCharacter(assets, look);
        built.root.traverse((n) => {
          n.castShadow = true;
        });
        built.play("idle", 0);
        setCharacter(built);
      })
      .catch((error: unknown) => console.error("player avatar:", error));
    return () => {
      cancelled = true;
      built?.mixer.stopAllAction();
      setCharacter(null);
    };
  }, [look]);

  // Keyboard: held keys are sampled every frame.
  useEffect(() => {
    const keys = held.current;
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      keys.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.delete(e.code);
    const clear = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Click-to-move: a left click on the canvas, as a camera ray (a building click goes to its door).
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || fade.current.phase !== "idle") return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      const { origin, direction } = raycaster.ray;
      // Building walls and doorways first, else the ground plane (shared pickClick).
      controller.clickRay([origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z]);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [gl, get, controller]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const world = worldStore.getState();

    // Door fade: out, swap spaces at full cover, wait for the new room's meshes, back in.
    if (fade.current.phase !== "idle") {
      const r = stepFade(fade.current, dt, world.ready);
      fade.current = r.fade;
      if (r.swap) {
        const to = controller.completeTransition();
        if (to) {
          world.setSpace(to.space);
          heading.current = to.heading;
          cameraRig.snap = true;
        }
      }
      worldStore.setState({ fade: fade.current.cover });
    }

    const keys = held.current;
    const screen = screenDirection(keys);
    const run = RUN_KEYS.some((k) => keys.has(k));
    controller.setInput(screenToWorld(screen, yawForStep(dioramaStore.getState().cameraStep)), run);
    if (fade.current.phase === "idle" && controller.update(dt)) {
      fade.current = startFade();
      worldStore.setState({ fade: 0 });
    }

    const { pos, motion } = controller.state;
    cameraRig.follow = [pos[0], 0, pos[1]];
    heading.current = dampAngle(heading.current, controller.state.heading, TURN_RATE, dt);
    const g = avatar.current;
    if (g) {
      g.position.set(pos[0], 0, pos[1]);
      g.rotation.y = heading.current;
    }
    if (character) {
      character.play(motion === "run" ? "run" : motion === "walk" ? "walk" : "idle", 0.2);
      character.mixer.update(dt);
    }
    const m = marker.current;
    if (m) {
      const goal: Vec2 | undefined = controller.waypoints?.at(-1);
      m.visible = goal !== undefined;
      if (goal) m.position.set(goal[0], 0.03, goal[1]);
    }
    // Before the camera (priority 0) so it follows this frame's position.
  }, -1);

  const markerResources = useMemo(
    () => ({ geometry: new RingGeometry(0.16, 0.24, 24).rotateX(-Math.PI / 2), material: new MeshBasicMaterial({ color: "#fff6e0", transparent: true, opacity: 0.8, depthWrite: false }) }),
    [],
  );
  useEffect(
    () => () => {
      markerResources.geometry.dispose();
      markerResources.material.dispose();
    },
    [markerResources],
  );

  return (
    <>
      <group ref={avatar} name="player">
        {character ? <primitive object={character.root} /> : null}
      </group>
      <mesh ref={marker} geometry={markerResources.geometry} material={markerResources.material} visible={false} renderOrder={5} />
    </>
  );
}
