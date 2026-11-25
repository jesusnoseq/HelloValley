import type { User } from "firebase/auth";
import { AuthGate } from "./auth/AuthGate";
import { signOutUser } from "./auth/useAuth";
import { useTownConnection } from "./net/connection";
import { DebugOverlay } from "./ui/DebugOverlay";

export function App() {
  return <AuthGate>{(user) => <Town user={user} />}</AuthGate>;
}

function Town({ user }: { user: User }) {
  const connection = useTownConnection(user);
  return (
    <>
      <h1>HelloValley</h1>
      <p>
        Signed in as {user.displayName ?? user.email ?? user.uid}.{" "}
        <button type="button" onClick={() => void signOutUser()}>
          Sign out
        </button>
      </p>
      <DebugOverlay connection={connection} />
    </>
  );
}
