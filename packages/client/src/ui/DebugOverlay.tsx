import type { ConnectionState, ConnectionStatus } from "../net/connection";
import { hudPanel, PerfStats } from "./PerfHud";

const COLORS: Record<ConnectionStatus, string> = {
  connecting: "#c9a227",
  connected: "#3a9a5b",
  reconnecting: "#c9a227",
  disconnected: "#c0392b",
  replaced: "#8e8c8a",
};

/** Connection status and ping, plus the perf stats (fps, draw calls, tris) in dev builds. */
export function DebugOverlay({ connection }: { connection: ConnectionState }) {
  const { status, pingMs, uid, shard, error } = connection;
  return (
    <div style={hudPanel} data-testid="debug-overlay">
      <div role="status" aria-live="polite">
        <span aria-hidden="true" style={{ color: COLORS[status] }}>
          ●{" "}
        </span>
        server: {status}
        {status === "connected" && pingMs !== null ? ` · ${pingMs} ms` : ""}
        {status === "connected" && uid ? (
          <div style={{ opacity: 0.7 }}>
            uid: {uid}
            {shard !== null ? ` · shard ${shard}` : ""}
          </div>
        ) : null}
        {error && status !== "connected" ? <div style={{ opacity: 0.7 }}>{error}</div> : null}
      </div>
      {/* Outside the live region: it updates twice a second. */}
      <PerfStats />
    </div>
  );
}
