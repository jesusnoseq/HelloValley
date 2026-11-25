import type { PlayerProfile } from "@hellovalley/shared";
import type { User } from "firebase/auth";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import { createTranslator, uiLocaleFromBrowser } from "../i18n/i18n";

// Shared game data (zod), the Firestore SDK and the wizard load only after sign-in.
const Onboarding = lazy(() => import("../ui/onboarding/Onboarding"));

type GateState =
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "ready"; profile: PlayerProfile }
  | { status: "error" };

const message = { font: "16px system-ui, sans-serif", padding: 24 } as const;

/**
 * Between sign-in and the game (build plan M14): reads the player's `users/{uid}`; without one
 * the player goes through onboarding first, and the created profile is used straight away.
 */
export function ProfileGate({ user, children }: { user: User; children: (profile: PlayerProfile) => ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const t = createTranslator(uiLocaleFromBrowser(typeof navigator === "undefined" ? [] : navigator.languages ?? []));

  useEffect(() => {
    let cancelled = false;
    import("./profileSource")
      .then(({ loadProfile }) => loadProfile(user.uid))
      .then(
        (profile) => {
          if (!cancelled) setState(profile ? { status: "ready", profile } : { status: "onboarding" });
        },
        (error: unknown) => {
          console.error("profile:", error);
          if (!cancelled) setState({ status: "error" });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [user, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  const loading = (
    <p role="status" style={message}>
      {t("common.loading")}
    </p>
  );

  switch (state.status) {
    case "loading":
      return loading;
    case "error":
      return (
        <div role="alert" style={message}>
          <p>{t("profile.loadError")}</p>
          <button type="button" onClick={retry}>
            {t("common.retry")}
          </button>
        </div>
      );
    case "onboarding":
      return (
        <Suspense fallback={loading}>
          <Onboarding user={user} onComplete={(profile) => setState({ status: "ready", profile })} />
        </Suspense>
      );
    case "ready":
      return <>{children(state.profile)}</>;
  }
}
