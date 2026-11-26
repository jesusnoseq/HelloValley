import type { PlayerProfile } from "@hellovalley/shared";
import type { User } from "firebase/auth";
import { type CSSProperties, lazy, Suspense, useEffect } from "react";
import { checkOnDeviceAtLogin, setAiUser, startWarmUp } from "./ai/client";
import { AuthGate } from "./auth/AuthGate";
import { signOutUser } from "./auth/useAuth";
import { uiLocaleFor } from "./i18n/i18n";
import { I18nProvider, useI18n } from "./i18n/I18nProvider";
import { useApartmentConnection } from "./net/apartmentConnection";
import { useTownConnection } from "./net/connection";
import { ProfileGate } from "./profile/ProfileGate";
import { DioramaView } from "./scene/DioramaView";
import { SPAWN_TARGET, TOWN_SHADOW_EXTENT } from "./scene/townCamera";
import { avatarStore, useAvatar } from "./state/avatarStore";
import { dioramaStore } from "./state/dioramaStore";
import { AiStatusChip } from "./ui/AiStatusChip";
import { ApartmentHud } from "./ui/apartment/ApartmentHud";
import { ChatHud } from "./ui/chat/ChatHud";
import { DebugOverlay } from "./ui/DebugOverlay";
import { FadeOverlay } from "./ui/FadeOverlay";
import { MirrorLayer } from "./ui/mirror/MirrorLayer";
import type { SaveAppearance } from "./ui/mirror/MirrorPanel";

// The world pulls in shared game data (and zod): keep it in its own chunk, after sign-in.
const WorldScene = lazy(() => import("./scene/World").then((m) => ({ default: m.World })));
// Build plan M23: the NPC conversation panel carries shared game rules too (its own lazy chunk).
const ConversationLayer = lazy(() => import("./ui/conversation/ConversationLayer").then((m) => ({ default: m.ConversationLayer })));
// Build plan M25: the notebook panel and review session (shared FSRS rules, its own lazy chunk).
const NotebookLayer = lazy(() =>
  Promise.all([import("./ui/notebook/NotebookLayer"), import("./notebook/startNotebook")]).then(([m, n]) => ({
    default: () => <m.NotebookLayer notebook={n.currentNotebook} />,
  })),
);

// Build plan M26: the hotbar and the bag (Tab), with item data and world labels (its own lazy chunk).
const InventoryLayer = lazy(() => import("./ui/inventory/InventoryLayer").then((m) => ({ default: m.InventoryLayer })));
// Build plan M27: casting, the reel mini-game, the catch card and the fish book (its own lazy chunk).
const FishingLayer = lazy(() => import("./ui/fishing/FishingLayer").then((m) => ({ default: m.FishingLayer })));
// Build plan M28: the pick-up hint and notice and the forage album (its own lazy chunk).
const ForageLayer = lazy(() => import("./ui/forage/ForageLayer").then((m) => ({ default: m.ForageLayer })));
// Build plan M29: eating from the hotbar, the buff HUD, seats and the kitchen's recipe cards (its own lazy chunk).
const FoodLayer = lazy(() => import("./ui/food/FoodLayer").then((m) => ({ default: m.FoodLayer })));

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
  // Build plan M17: the ApartmentRoom of the apartment the player is in (theirs, or a host's).
  useApartmentConnection(user, connection.uid);
  // The town renders in the player's style (kits that do not exist yet fall back, scene/kitLoader).
  // TODO(M37): the Settings screen changes it (and writes users/{uid}.style).
  useEffect(() => {
    dioramaStore.getState().setStyle(profile.style);
  }, [profile.style]);
  // The avatar renders from the profile; a saved mirror edit replaces it (build plan M15).
  useEffect(() => {
    avatarStore.getState().setProfile(profile);
    return () => avatarStore.getState().setProfile(null);
  }, [profile]);
  // Build plan M19: the script toggle is saved per target language in users/{uid}/langs/{lang}.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import("./ui/speech/scriptModeSync").then(({ startScriptModeSync }) => {
      if (!cancelled) stop = startScriptModeSync(user.uid, profile.targetLangs);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [user.uid, profile.targetLangs]);
  // Build plan M25: the notebook of the first target language mirrors users/{uid}/langs/{lang}/notebook
  // and saves every clicked word (bubbles, chat, world labels). TODO(M37): a target-language switcher.
  const targetLang = profile.targetLangs[0] ?? null;
  useEffect(() => {
    if (!targetLang) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void import("./notebook/startNotebook").then(({ startNotebook }) => {
      if (!cancelled) stop = startNotebook(user, targetLang, profile.nativeLang);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [user, targetLang, profile.nativeLang]);
  // Build plan M20: AI answers are cached in this player's IndexedDB; a returning player whose
  // on-device model is still downloadable starts the download on a click or key press (startWarmUp does nothing otherwise).
  useEffect(() => {
    setAiUser(user.uid);
    void checkOnDeviceAtLogin();
    const gesture = () => startWarmUp();
    window.addEventListener("pointerdown", gesture);
    window.addEventListener("keydown", gesture);
    return () => {
      window.removeEventListener("pointerdown", gesture);
      window.removeEventListener("keydown", gesture);
      setAiUser(null);
    };
  }, [user.uid]);
  const name = useAvatar((s) => s.profile?.name) ?? profile.name;
  // The API client pulls in shared schemas (zod): load it on first save, not in the entry chunk.
  const saveAppearance: SaveAppearance = (appearance) =>
    import("./net/api").then(({ putAppearance }) => putAppearance(user, appearance)).then((r) => r.profile);
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
      <MirrorLayer save={saveAppearance} />
      <ApartmentHud />
      {/* Build plan M18: proximity chat, read in the first target language (TODO(M37): a switcher). */}
      <ChatHud targetLang={profile.targetLangs[0] ?? profile.nativeLang} nativeLang={profile.nativeLang} />
      <Suspense fallback={null}>
        <ConversationLayer />
      </Suspense>
      <Suspense fallback={null}>
        <NotebookLayer />
      </Suspense>
      <Suspense fallback={null}>
        <InventoryLayer />
      </Suspense>
      <Suspense fallback={null}>
        <FishingLayer />
      </Suspense>
      <Suspense fallback={null}>
        <ForageLayer />
      </Suspense>
      <Suspense fallback={null}>
        <FoodLayer />
      </Suspense>
      <div style={card}>
        <h1 style={{ margin: 0, fontSize: 18 }}>{t("app.name")}</h1>
        <p style={{ margin: "4px 0 0" }}>
          {name} · {t("hud.apartment", { apartment: profile.apartmentId })}
          {connection.shard !== null ? ` · ${t("hud.shard", { shard: String(connection.shard) })}` : ""}
        </p>
        {connection.status === "replaced" ? <p style={{ margin: "2px 0 0", fontSize: 12 }}>{t("hud.replaced")}</p> : null}
        <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.75 }}>
          {t("hud.signedInAs", { name: user.displayName ?? user.email ?? user.uid })}{" "}
          <button type="button" onClick={() => void signOutUser()}>
            {t("common.signOut")}
          </button>
        </p>
      </div>
      <AiStatusChip />
      <DebugOverlay connection={connection} />
    </DioramaView>
  );
}
