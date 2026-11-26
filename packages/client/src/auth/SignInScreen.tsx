import { type CSSProperties, useState } from "react";
import { firebaseConfig } from "../firebase/app";
import { createTranslator, uiLocaleFromBrowser } from "../i18n/i18n";
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

/**
 * Google sign-in is required to play (GDD §9.3); onboarding follows (profile/ProfileGate). Shown in
 * the browser's language when there is a UI catalogue for it (the native language is not known yet,
 * build plan M37). Sign-in errors come from Firebase and stay in English.
 */
export function SignInScreen() {
  const locale = uiLocaleFromBrowser(typeof navigator === "undefined" ? [] : navigator.languages);
  const t = createTranslator(locale);
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
    <main style={page} lang={locale} className="hv-signin">
      <section style={card} aria-labelledby="sign-in-title">
        <h1 id="sign-in-title" style={{ margin: 0 }}>
          HelloValley
        </h1>
        <p>{t("signin.tagline")}</p>
        <button type="button" style={button} onClick={signIn} disabled={busy} aria-busy={busy}>
          {busy ? t("signin.busy") : t("signin.google")}
        </button>
        {error ? (
          <p role="alert" style={{ color: "var(--hv-warn)", marginBottom: 0 }}>
            {error}
          </p>
        ) : null}
        {firebaseConfig.emulators ? (
          <p style={{ fontSize: 12, color: "#5e5852", marginBottom: 0 }}>Local emulators ({firebaseConfig.options.projectId})</p>
        ) : null}
      </section>
    </main>
  );
}
