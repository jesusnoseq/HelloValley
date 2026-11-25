import type { AppearanceUpdateRequest, AvatarAppearance, PlayerProfile } from "@hellovalley/shared";
import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import { ApiError } from "../../net/api";
import { avatarStore } from "../../state/avatarStore";
import { AppearanceEditor } from "../onboarding/AppearanceEditor";
import type { AppearanceDraft } from "../onboarding/draft";
import { appearanceFromDraft, draftFromAppearance, isDirty } from "./mirrorDraft";
import "../onboarding/onboarding.css";
import "./mirror.css";

/** Saves an appearance; resolves with the updated profile (`PUT /api/profile/appearance`). */
export type SaveAppearance = (appearance: AppearanceUpdateRequest) => Promise<PlayerProfile>;

type SaveState = { state: "idle" } | { state: "saving" } | { state: "failed"; message: MessageKey };

/**
 * The apartment mirror (GDD §3.3, build plan M15): the onboarding appearance editor (animal
 * carousel with the 3D preview, fur tints, shirt and trousers colours) in a dialog. Every edit
 * shows live on the avatar in the room (avatarStore.preview); Save sends it to the server and the
 * answer becomes the profile, Close (or Esc) drops unsaved edits.
 * TODO(M25): the mirror labels the clothing items in the target language (world labels).
 */
export default function MirrorPanel({ saved, save }: { saved: AvatarAppearance; save: SaveAppearance }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<AppearanceDraft>(() => draftFromAppearance(saved));
  const [status, setStatus] = useState<SaveState>({ state: "idle" });
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = isDirty(saved, draft);
  const saving = status.state === "saving";

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) avatarStore.getState().closeMirror();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving]);

  const change = (next: AppearanceDraft) => {
    setDraft(next);
    if (status.state === "failed") setStatus({ state: "idle" });
    // Live on the avatar in the room while editing.
    avatarStore.getState().setPreview(appearanceFromDraft(next));
  };

  const submit = async () => {
    const appearance = appearanceFromDraft(draft);
    if (!appearance || !dirty) return;
    setStatus({ state: "saving" });
    try {
      const profile = await save(appearance);
      const store = avatarStore.getState();
      store.setProfile(profile);
      store.closeMirror();
    } catch (err) {
      console.error("mirror:", err);
      const network = err instanceof ApiError && err.code === "network";
      setStatus({ state: "failed", message: network ? "mirror.error.network" : "mirror.error.generic" });
    }
  };

  return (
    <div className="hv-onb hv-mirror" role="presentation">
      <form
        className="hv-onb-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hv-mirror-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="hv-mirror-title" ref={heading} tabIndex={-1}>
          {t("mirror.title")}
        </h2>
        <p className="hv-onb-hint">{t("mirror.hint")}</p>
        <div className="hv-mirror-glass">
          <AppearanceEditor value={draft} onChange={change} />
        </div>
        {status.state === "failed" ? (
          <p className="hv-onb-error" role="alert">
            {t(status.message)}
          </p>
        ) : null}
        <div className="hv-onb-nav">
          <button type="button" className="hv-onb-secondary" onClick={() => avatarStore.getState().closeMirror()} disabled={saving}>
            {t("mirror.close")}
          </button>
          <button type="submit" className="hv-onb-primary" disabled={saving || !dirty} aria-busy={saving} title={dirty ? undefined : t("mirror.unchanged")}>
            {saving ? t("mirror.saving") : t("mirror.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
