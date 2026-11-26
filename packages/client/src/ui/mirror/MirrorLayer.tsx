import { type CSSProperties, lazy, Suspense } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { avatarStore, useAvatar } from "../../state/avatarStore";
import { useWorld } from "../../state/worldStore";
import type { SaveAppearance } from "./MirrorPanel";
import { useActionKey } from "../../settings/keyNames";

const MirrorPanel = lazy(() => import("./MirrorPanel"));

const prompt: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: 24,
  transform: "translateX(-50%)",
  padding: "8px 16px",
  border: 0,
  borderRadius: 999,
  background: "rgba(255, 250, 240, 0.92)",
  color: "#3d3a44",
  font: "600 14px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.15)",
  cursor: "pointer",
};

/**
 * The mirror's HUD (build plan M15): a "Press F" prompt while the player stands at the apartment
 * mirror (clicking it works too), and the mirror dialog while it is open. Needs a profile in
 * avatarStore (the App sets it; the dev page sets a fake one).
 */
export function MirrorLayer({ save }: { save: SaveAppearance }) {
  const { t } = useI18n();
  const interactKey = useActionKey("interact");
  const nearby = useWorld((s) => s.nearby);
  const open = useAvatar((s) => s.mirrorOpen);
  const profile = useAvatar((s) => s.profile);
  if (!profile) return null;
  if (open) {
    return (
      <Suspense fallback={null}>
        <MirrorPanel saved={{ animal: profile.animal, colors: profile.colors }} save={save} />
      </Suspense>
    );
  }
  if (nearby?.kind !== "mirror") return null;
  return (
    <button type="button" style={prompt} aria-label={t("interact.mirror.button")} onClick={() => avatarStore.getState().openMirror()}>
      {t("interact.mirror", { key: interactKey.name })}
    </button>
  );
}
