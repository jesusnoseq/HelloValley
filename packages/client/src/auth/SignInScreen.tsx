import { type CSSProperties, useState } from "react";
import { firebaseConfig } from "../firebase/app";
import { signInErrorMessage, signInWithGoogle } from "./useAuth";

const page: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#f6efdc",
  color: "#3a3634",
  font: "16px/1.5 system-ui, sans-serif",
};

const card: CSSProperties = {
  maxWidth: 360,
  padding: "32px 28px",
  borderRadius: 16,
  background: "#fffaf0",
  boxShadow: "0 8px 24px rgba(58, 54, 52, 0.12)",
  textAlign: "center",
};

const button: CSSProperties = {
  marginTop: 16,
  padding: "10px 20px",
  border: "1px solid #55565c",
  borderRadius: 999,
  background: "#ffffff",
  color: "#3a3634",
  font: "inherit",
  cursor: "pointer",
};

/** Google sign-in is required to play (GDD §9.3). TODO(M14): onboarding follows sign-in. */
export function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={page}>
      <section style={card} aria-labelledby="sign-in-title">
        <h1 id="sign-in-title" style={{ margin: 0 }}>
          HelloValley
        </h1>
        <p>A cozy town where everyone speaks the language you are learning.</p>
        <button type="button" style={button} onClick={signIn} disabled={busy} aria-busy={busy}>
          {busy ? "Signing in…" : "Sign in with Google"}
        </button>
        {error ? (
          <p role="alert" style={{ color: "#a33a2a", marginBottom: 0 }}>
            {error}
          </p>
        ) : null}
        {firebaseConfig.emulators ? (
          <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 0 }}>Local emulators ({firebaseConfig.options.projectId})</p>
        ) : null}
      </section>
    </main>
  );
}
