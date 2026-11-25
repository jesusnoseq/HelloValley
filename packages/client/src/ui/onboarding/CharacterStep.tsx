import { PLAYER_NAME_MAX_LENGTH } from "@hellovalley/shared";
import { useId } from "react";
import type { MessageKey } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import { AppearanceEditor } from "./AppearanceEditor";
import type { OnboardingDraft } from "./draft";

/**
 * Character creation (GDD §2.1 step 5, §3): name (moderated by the server) plus the appearance
 * editor (animal carousel with a live 3D preview, fur tints, shirt and trousers colours), which
 * the apartment mirror reuses (M15).
 * TODO(M20): show the on-device model warm-up chip ("Speeding up translations…") here.
 */
export function CharacterStep({
  draft,
  onChange,
  nameError,
  showNameError,
}: {
  draft: OnboardingDraft;
  onChange: (next: OnboardingDraft) => void;
  nameError: MessageKey | null;
  showNameError: boolean;
}) {
  const { t } = useI18n();
  const nameId = useId();
  const nameHintId = useId();
  const nameErrorId = useId();
  const invalid = showNameError && nameError !== null;

  return (
    <AppearanceEditor
      value={draft}
      onChange={onChange}
      fields={
        <div className="hv-onb-field">
          <label htmlFor={nameId}>{t("onboarding.name.label")}</label>
          <input
            id={nameId}
            className="hv-onb-name"
            value={draft.name}
            maxLength={PLAYER_NAME_MAX_LENGTH + 8}
            autoComplete="nickname"
            spellCheck={false}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${nameHintId} ${nameErrorId}` : nameHintId}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
          <small id={nameHintId}>{t("onboarding.name.hint")}</small>
          {invalid ? (
            <p id={nameErrorId} className="hv-onb-error" role="alert">
              {t(nameError)}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
