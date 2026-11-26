import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, type BufferGeometry, ConeGeometry, CylinderGeometry, type Group, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, TorusGeometry } from "three";
import { type CollectibleId, getForage, type ForageKind } from "@hellovalley/shared";
import { type ClientSpawn, useForage } from "../state/forageStore";

/** Placeholder looks per forage kind: a shape and a colour (no milestone builds forage props; pending.md §M28). */
type Shape = "bloom" | "cap" | "shell" | "pebble" | "crystal" | "berries" | "leaf" | "coin" | "letter" | "lost";

const SHAPE_FOR_KIND: Readonly<Record<ForageKind, Shape>> = {
  flower: "bloom",
  mushroom: "cap",
  shell: "shell",
  pebble: "pebble",
  berry: "berries",
  herb: "leaf",
  rare_find: "coin",
};

const COLOR: Partial<Record<CollectibleId, string>> = {
  daisy: "#fbf7ea",
  poppy: "#e0453a",
  bluebell: "#6f7fe0",
  button_mushroom: "#efe3cf",
  chanterelle: "#e9a23b",
  river_shell: "#f2d9c4",
  spiral_shell: "#e8b7a8",
  smooth_pebble: "#9a9a96",
  crystal_pebble: "#9be3f0",
  wild_berries: "#7a2f7a",
  wild_herb: "#5aa64a",
  mint: "#7fd39a",
  old_coin: "#d8b23a",
  old_letter: "#efe6cf",
};

function shapeOf(itemId: CollectibleId, kind: ClientSpawn["kind"]): Shape {
  if (kind === "lost") return "lost";
  if (itemId === "crystal_pebble") return "crystal";
  if (itemId === "old_letter") return "letter";
  const def = getForage(itemId);
  return def ? SHAPE_FOR_KIND[def.kind] : "pebble";
}

/** Height of each shape's centre above the ground (metres). */
const LIFT: Readonly<Record<Shape, number>> = { bloom: 0.16, cap: 0.1, shell: 0.04, pebble: 0.04, crystal: 0.09, berries: 0.08, leaf: 0.12, coin: 0.03, letter: 0.02, lost: 0.35 };

/**
 * The day's forage spawns and lost items lying in town (build plan M28, GDD §5.3), from the
 * room's synced `forage` map: small placeholder props by kind (blooms, caps, shells, pebbles,
 * berries, leaves, coins and letters) and, for lost items, a glinting golden ring bobbing above
 * the spot ("something shiny…"). The spawn within reach grows a little; F picks it up.
 */
export function ForageSpawns({ visible }: { visible: boolean }) {
  const spawns = useForage((s) => s.spawns);
  const nearby = useForage((s) => s.nearby);
  const list = useMemo(() => Object.values(spawns), [spawns]);
  const group = useRef<Group>(null);

  const res = useMemo(() => {
    const geometry: Record<Shape, BufferGeometry> = {
      bloom: new SphereGeometry(0.1, 10, 6),
      cap: new ConeGeometry(0.13, 0.16, 10),
      shell: new SphereGeometry(0.09, 10, 6).scale(1, 0.45, 1.2),
      pebble: new SphereGeometry(0.08, 8, 5).scale(1.3, 0.5, 1),
      crystal: new OctahedronGeometry(0.1),
      berries: new SphereGeometry(0.08, 8, 6),
      leaf: new ConeGeometry(0.08, 0.24, 6),
      coin: new CylinderGeometry(0.08, 0.08, 0.025, 14),
      letter: new BoxGeometry(0.22, 0.02, 0.15),
      lost: new TorusGeometry(0.13, 0.035, 8, 20),
    };
    const materials = new Map<string, MeshStandardMaterial>();
    const material = (color: string, shiny = false) => {
      const key = `${color}${shiny ? ":shiny" : ""}`;
      let m = materials.get(key);
      if (!m) {
        m = new MeshStandardMaterial({ color, roughness: shiny ? 0.25 : 0.7, metalness: shiny ? 0.6 : 0, emissive: shiny ? color : "#000000", emissiveIntensity: shiny ? 0.35 : 0 });
        materials.set(key, m);
      }
      return m;
    };
    return { geometry, material, materials };
  }, []);
  useEffect(
    () => () => {
      for (const g of Object.values(res.geometry)) g.dispose();
      for (const m of res.materials.values()) m.dispose();
    },
    [res],
  );

  // Lost items bob and spin so they catch the eye.
  useFrame(() => {
    const g = group.current;
    if (!g?.visible) return;
    const t = performance.now() / 1000;
    for (const child of g.children) {
      if (child.userData.lost !== true) continue;
      child.position.y = LIFT.lost + Math.sin(t * 2 + child.position.x) * 0.06;
      child.rotation.y = t * 1.5;
    }
  });

  return (
    <group ref={group} name="forage-spawns" visible={visible}>
      {list.map((s) => {
        const shape = shapeOf(s.itemId, s.kind);
        const lost = shape === "lost";
        return (
          <mesh
            key={s.spawnId}
            name={`forage:${s.spawnId}`}
            userData={{ lost }}
            geometry={res.geometry[shape]}
            material={res.material(lost ? "#f2c94c" : (COLOR[s.itemId] ?? "#c9c2b0"), lost || shape === "crystal" || shape === "coin")}
            position={[s.x, LIFT[shape], s.z]}
            rotation={lost ? [0, 0, 0] : [0, (s.x * 7) % Math.PI, 0]}
            scale={s.spawnId === nearby ? 1.35 : 1}
            castShadow
          />
        );
      })}
    </group>
  );
}
