import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, CircleGeometry, type Group, Line, LineBasicMaterial, type Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from "three";
import { type FishShadow, TERRAIN_TOP, TERRAIN_Y } from "@hellovalley/shared";
import { fishingLive, fishingStore, useFishing } from "../state/fishingStore";
import { useWorld } from "../state/worldStore";

/** The river surface in the town frame. */
const WATER_Y = TERRAIN_TOP.water + TERRAIN_Y;
/** Shadow radius by size (metres, my numbers). */
const SHADOW_RADIUS: Readonly<Record<FishShadow, number>> = { small: 0.16, medium: 0.24, large: 0.34 };
/** The shadow starts this far from the bobber and swims in (metres). */
const SHADOW_START_M = 2.2;
/** Where the rod tip is relative to the player (metres forward and up). */
const ROD_TIP: [number, number] = [0.55, 1.35];

/**
 * The line in the water (build plan M27, GDD §5.2): the bobber where the server said the cast
 * landed, the line from the rod tip, and the fish shadow swimming in during the wait. At the bite
 * the bobber dips; while reeling it jerks with the fish. Only the angler sees it (the server sends
 * the cast to them alone); others see the casting and reeling clips.
 */
export function FishingLine() {
  const space = useWorld((s) => s.space);
  const phase = useFishing((s) => s.phase);
  const cast = useFishing((s) => s.cast);
  const showing = space === "town" && cast !== null && (phase === "waiting" || phase === "bite" || phase === "reeling" || phase === "landing");
  const bobber = useRef<Mesh>(null);
  const shadow = useRef<Mesh>(null);
  const group = useRef<Group>(null);

  const res = useMemo(() => {
    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    return {
      bobberGeometry: new SphereGeometry(0.07, 12, 8),
      bobberMaterial: new MeshStandardMaterial({ color: "#e8483b", roughness: 0.5 }),
      shadowGeometry: new CircleGeometry(1, 20).rotateX(-Math.PI / 2).scale(1, 1, 1.8),
      shadowMaterial: new MeshBasicMaterial({ color: "#10202a", transparent: true, opacity: 0.35, depthWrite: false }),
      line: new Line(lineGeometry, new LineBasicMaterial({ color: "#f4f1e8", transparent: true, opacity: 0.8 })),
    };
  }, []);
  useEffect(
    () => () => {
      res.bobberGeometry.dispose();
      res.bobberMaterial.dispose();
      res.shadowGeometry.dispose();
      res.shadowMaterial.dispose();
      res.line.geometry.dispose();
      (res.line.material as LineBasicMaterial).dispose();
    },
    [res],
  );

  useFrame(() => {
    const s = fishingStore.getState();
    const c = s.cast;
    const b = bobber.current;
    const sh = shadow.current;
    if (!c || !b || !sh || !group.current?.visible) return;
    const now = performance.now();
    const t = now / 1000;
    const bx = c.bobber.x;
    const bz = c.bobber.z;
    // The bobber floats, dips hard at the bite and jerks while reeling.
    let dy = Math.sin(t * 2.2) * 0.015;
    if (s.phase === "bite") dy = -0.06 + Math.sin(t * 28) * 0.025;
    else if (s.phase === "reeling" || s.phase === "landing") dy = -0.03 + Math.sin(t * 17) * 0.02;
    b.position.set(bx, WATER_Y + 0.03 + dy, bz);

    // The shadow swims in from out in the river over the wait (angle from the reel seed).
    const radius = SHADOW_RADIUS[c.shadow];
    sh.scale.setScalar(radius);
    const angle = (c.reelSeed % 360) * (Math.PI / 180);
    const start = (s.biteAtMs ?? now) - c.biteInMs;
    const k = s.phase === "waiting" ? Math.min(1, Math.max(0, (now - start) / Math.max(1, c.biteInMs))) : 1;
    const ease = 1 - (1 - k) * (1 - k);
    const wobble = s.phase === "waiting" ? Math.sin(t * 3) * 0.25 * (1 - ease) : Math.sin(t * 9) * 0.05;
    const d = SHADOW_START_M * (1 - ease) + radius * 0.6;
    sh.position.set(bx + Math.cos(angle + wobble) * d, WATER_Y + 0.012, bz + Math.sin(angle + wobble) * d);
    sh.rotation.y = -angle + Math.PI / 2;

    // The line from the rod tip to the bobber.
    const p = fishingLive.pos;
    if (p) {
      const h = s.heading ?? fishingLive.heading;
      const attr = res.line.geometry.getAttribute("position") as BufferAttribute;
      attr.setXYZ(0, p[0] + Math.sin(h) * ROD_TIP[0], ROD_TIP[1], p[1] + Math.cos(h) * ROD_TIP[0]);
      attr.setXYZ(1, b.position.x, b.position.y + 0.05, b.position.z);
      attr.needsUpdate = true;
      res.line.geometry.computeBoundingSphere();
    }
  });

  return (
    <group ref={group} name="fishing-line" visible={showing}>
      <mesh ref={bobber} geometry={res.bobberGeometry} material={res.bobberMaterial} castShadow />
      <mesh ref={shadow} geometry={res.shadowGeometry} material={res.shadowMaterial} renderOrder={4} />
      <primitive object={res.line} />
    </group>
  );
}
