import type { CSSProperties } from "react";
import type { ConnectionState, ConnectionStatus } from "../net/connection";

const COLORS: Record<ConnectionStatus, string> = {
  connecting: "#c9a227",
  connected: "#3a9a5b",
  reconnecting: "#c9a227",
  disconnected: "#c0392b",
};

const panel: CSSProperties = {
  position: "fixed",
  top: 8,
  right: 8,
  padding: "6px 10px",
  borderRadius: 6,
  background: "rgba(20, 20, 24, 0.8)",
  color: "#f4f1ea",
  font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  pointerEvents: "none",
};

/** Connection status and ping. TODO(M09): merge into the dev perf HUD (fps, draw calls, tris). */
export function DebugOverlay({ connection }: { connection: ConnectionState }) {
  const { status, pingMs, uid, error } = connection;
  return (
    <div style={panel} role="status" aria-live="polite" data-testid="debug-overlay">
      <div>
        <span aria-hidden="true" style={{ color: COLORS[status] }}>
          ●{" "}
        </span>
        server: {status}
        {status === "connected" && pingMs !== null ? ` · ${pingMs} ms` : ""}
      </div>
      {status === "connected" && uid ? <div style={{ opacity: 0.7 }}>uid: {uid}</div> : null}
      {error && status !== "connected" ? <div style={{ opacity: 0.7 }}>{error}</div> : null}
    </div>
  );
}
