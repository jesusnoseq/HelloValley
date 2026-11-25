import type { User } from "firebase/auth";
import type { ReactNode } from "react";
import { SignInScreen } from "./SignInScreen";
import { useAuth } from "./useAuth";

/**
 * Renders `children` only for a signed-in user; shows the sign-in screen otherwise.
 * TODO(M14): send users without a `users/{uid}` profile to onboarding first.
 */
export function AuthGate({ children }: { children: (user: User) => ReactNode }) {
  const state = useAuth();
  if (state.status === "loading") {
    return (
      <p role="status" style={{ font: "16px system-ui, sans-serif", padding: 24 }}>
        Loading…
      </p>
    );
  }
  if (state.status === "signedOut") return <SignInScreen />;
  return <>{children(state.user)}</>;
}
