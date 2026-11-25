import { Html } from "@react-three/drei";
import type { CSSProperties } from "react";

const pill: CSSProperties = {
  padding: "1px 8px",
  borderRadius: 999,
  background: "rgba(255, 250, 240, 0.92)",
  color: "#3d3a44",
  font: "13px/1.4 system-ui, sans-serif",
  boxShadow: "0 1px 6px rgba(0, 0, 0, 0.18)",
  pointerEvents: "none",
  whiteSpace: "nowrap",
};

/**
 * The "chatting" indicator over a player and the NPC they talk to (build plan M23, GDD §8.1):
 * bystanders see who is in a conversation. A DOM overlay like the chat bubbles (no draw calls).
 */
export function ChattingIndicator({ y }: { y: number }) {
  return (
    <Html position={[0, y, 0]} center zIndexRange={[19, 0]}>
      <div style={pill} aria-hidden="true">
        💬 …
      </div>
    </Html>
  );
}
