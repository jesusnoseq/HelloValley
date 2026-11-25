import { useEffect, useRef } from "react";
import { fadeOpacity } from "../scene/playerMath";
import { worldStore } from "../state/worldStore";

/**
 * The door fade (build plan M13): a full-window warm dark cover whose opacity follows
 * `worldStore.fade`, set imperatively so the per-frame fade never re-renders React.
 */
export function FadeOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = (cover: number) => {
      const el = ref.current;
      if (!el) return;
      const opacity = fadeOpacity(cover);
      el.style.opacity = String(opacity);
      el.style.visibility = opacity > 0 ? "visible" : "hidden";
    };
    apply(worldStore.getState().fade);
    return worldStore.subscribe((s, prev) => {
      if (s.fade !== prev.fade) apply(s.fade);
    });
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, background: "#2b2230", opacity: 0, visibility: "hidden", pointerEvents: "none" }}
    />
  );
}
