import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Raycaster, Vector2 } from "three";
import { type LabelledObject, labelledObjects, npcBoxes, pickLabel } from "@hellovalley/shared";
import { liveNpcLocator } from "../net/townSession";
import { requestLabels } from "../labels/labelStore";
import { useAvatar } from "../state/avatarStore";
import { useDiorama } from "../state/dioramaStore";
import { useWorld } from "../state/worldStore";
import { LabelChip } from "../ui/labels/LabelChip";
import { useApartmentLayout } from "./apartmentLayout";

/** The label stays this long after the pointer leaves the object, so it can be clicked (ms). */
const LINGER_MS = 600;

/**
 * World labels on hover (GDD §6.5, §10 "hover object → label", build plan M25): the pointer is
 * ray-tested against the space's labelled objects (shared `labelledObjects`: props, signs and
 * buildings in town; furniture, the door and the villagers indoors), and the nearest one shows
 * its target-language word above it. Clicking the word plays it and saves it to the notebook.
 * A DOM overlay (drei `Html`), so it costs no draw calls.
 */
export function WorldLabels() {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const space = useWorld((s) => s.space);
  const lang = useAvatar((s) => s.profile?.targetLangs[0] ?? null);
  const apartment = useApartmentLayout();
  // Town props are named as the player's style dresses them (a stone lantern in Japan, M34).
  const style = useDiorama((s) => s.style);
  const objects = useMemo(() => labelledObjects(space, space === "apartment" ? apartment.interior.furniture : undefined, undefined, style), [space, apartment, style]);
  // The hovered object is kept with the objects it was picked from (a new space or layout clears it).
  const [hover, setHover] = useState<{ objects: readonly LabelledObject[]; obj: LabelledObject } | null>(null);
  const hovered = hover && hover.objects === objects ? hover.obj : null;
  const overChip = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lang) requestLabels(lang);
  }, [lang]);

  useEffect(() => {
    if (!lang) return;
    const setHovered = (obj: LabelledObject | null) => setHover((prev) => (obj === null ? null : prev?.obj.id === obj.id && prev.objects === objects ? prev : { objects, obj }));
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    let frame = 0;
    let last: PointerEvent | null = null;
    const test = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      const { origin, direction } = raycaster.ray;
      // Build plan M31: the villagers' boxes follow where they walk.
      const pool = [...objects.filter((o) => !o.id.startsWith("npc:")), ...npcBoxes(space, liveNpcLocator)];
      const hit = pickLabel(pool, [origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z]);
      if (hit) {
        if (clearTimer.current) clearTimeout(clearTimer.current);
        clearTimer.current = null;
        setHovered(hit);
      } else if (!clearTimer.current) {
        clearTimer.current = setTimeout(() => {
          clearTimer.current = null;
          if (!overChip.current) setHovered(null);
        }, LINGER_MS);
      }
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      frame ||= requestAnimationFrame(test);
    };
    const onLeave = () => {
      last = null;
      if (!overChip.current) setHovered(null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = null;
    };
  }, [gl, get, objects, lang, space]);

  if (!hovered || !lang) return null;
  return (
    <Html position={hovered.anchor} center zIndexRange={[15, 0]}>
      <div
        onPointerEnter={() => {
          overChip.current = true;
        }}
        onPointerLeave={() => {
          overChip.current = false;
          setHover(null);
        }}
      >
        <LabelChip lang={lang} labelKey={hovered.labelKey} />
      </div>
    </Html>
  );
}
