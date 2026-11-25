import type { PlayerProfile } from "@hellovalley/shared";
import type { User } from "firebase/auth";
import { type CSSProperties, lazy, Suspense, useEffect } from "react";
import { AuthGate } from "./auth/AuthGate";
import { signOutUser } from "./auth/useAuth";
import { uiLocaleFor } from "./i18n/i18n";
import { I18nProvider, useI18n } from "./i18n/I18nProvider";
import { useTownConnection } from "./net/connection";
import { ProfileGate } from "./profile/ProfileGate";
import { DioramaView } from "./scene/DioramaView";
import { SPAWN_TARGET, TOWN_SHADOW_EXTENT } from "./scene/townCamera";
import { dioramaStore } from "./state/dioramaStore";
import { DebugOverlay } from "./ui/DebugOverlay";
import { FadeOverlay } from "./ui/FadeOverlay";

// The world pulls in shared game data (and zod): keep it in its own chunk, after sign-in.
const WorldScene = lazy(() => import("./scene/World").then((m) => ({ default: m.World })));

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

/** Sign-in → profile (onboarding when there is none) → the town, starting in the apartment. */
export function App() {
  return (
    <AuthGate>
      {(user) => (
        <ProfileGate user={user}>
          {(profile) => (
            <I18nProvider locale={uiLocaleFor(profile.nativeLang)}>
              <Town user={user} profile={profile} />
            </I18nProvider>
          )}
        </ProfileGate>
      )}
    </AuthGate>
  );
}

function Town({ user, profile }: { user: User; profile: PlayerProfile }) {
  const { t } = useI18n();
  const connection = useTownConnection(user);
  // The town renders in the player's style (kits that do not exist yet fall back, scene/kitLoader).
  // TODO(M37): the Settings screen changes it (and writes users/{uid}.style).
  useEffect(() => {
    dioramaStore.getState().setStyle(profile.style);
  }, [profile.style]);
  return (
    <DioramaView
      target={SPAWN_TARGET}
      shadowExtent={TOWN_SHADOW_EXTENT}
      world={
        <Suspense fallback={null}>
          {/* New and returning players start in their own apartment (World's default start). */}
          <WorldScene />
        </Suspense>
      }
    >
      <FadeOverlay />
      <div style={card}>
        <h1 style={{ margin: 0, fontSize: 18 }}>{t("app.name")}</h1>
        <p style={{ margin: "4px 0 0" }}>
          {profile.name} · {t("hud.apartment", { apartment: profile.apartmentId })}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.75 }}>
          {t("hud.signedInAs", { name: user.displayName ?? user.email ?? user.uid })}{" "}
          <button type="button" onClick={() => void signOutUser()}>
            {t("common.signOut")}
          </button>
        </p>
      </div>
      <DebugOverlay connection={connection} />
    </DioramaView>
  );
}
