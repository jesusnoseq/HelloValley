import type { User } from "firebase/auth";
import type { CSSProperties } from "react";
import { AuthGate } from "./auth/AuthGate";
import { signOutUser } from "./auth/useAuth";
import { useTownConnection } from "./net/connection";
import { DioramaView } from "./scene/DioramaView";
import { DebugOverlay } from "./ui/DebugOverlay";

const card: CSSProperties = {
  position: "fixed",
  top: 8,
  left: 8,
  padding: "8px 14px",
  borderRadius: 10,
  background: "rgba(255, 250, 240, 0.9)",
  color: "#3d3a44",
  font: "14px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
};

export function App() {
  return <AuthGate>{(user) => <Town user={user} />}</AuthGate>;
}

function Town({ user }: { user: User }) {
  const connection = useTownConnection(user);
  // TODO(M11): the town layout replaces the placeholder blocks.
  return (
    <DioramaView>
      <div style={card}>
        <h1 style={{ margin: 0, fontSize: 18 }}>HelloValley</h1>
        <p style={{ margin: "4px 0 0" }}>
          Signed in as {user.displayName ?? user.email ?? user.uid}.{" "}
          <button type="button" onClick={() => void signOutUser()}>
            Sign out
          </button>
        </p>
      </div>
      <DebugOverlay connection={connection} />
    </DioramaView>
  );
}
