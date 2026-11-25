import { ANIMALS, clothingColorHex, getAnimal, PLAYER_NAME_MAX_LENGTH } from "@hellovalley/shared";
import { type KeyboardEvent, lazy, Suspense, useId } from "react";
import type { MessageKey } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import { ColorField } from "./ColorField";
import { cycleAnimal, type OnboardingDraft, setAnimal } from "./draft";

const CharacterPreview = lazy(() => import("./CharacterPreview"));

/**
 * Character creation (GDD §2.1 step 5, §3): name (moderated by the server), an animal carousel
 * with a live 3D preview, the animal's natural fur tints, and shirt and trousers colours.
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
  const animalLabelId = useId();
  const animal = getAnimal(draft.animal) ?? ANIMALS[0];
  const index = ANIMALS.findIndex((a) => a.id === animal.id);
  const furHex = animal.furTints.find((f) => f.id === draft.fur)?.hex ?? animal.furTints[0]!.hex;
  const step = (delta: number) => onChange(setAnimal(draft, cycleAnimal(draft.animal, delta)));
  const onCarouselKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const invalid = showNameError && nameError !== null;

  return (
    <div className="hv-onb-character">
      <div className="hv-onb-preview">
        <div className="hv-onb-stage" role="img" aria-label={`${t("onboarding.preview.label")}: ${t(`animal.${draft.animal}`)}`}>
          <Suspense fallback={<p className="hv-onb-stage-msg">{t("onboarding.preview.loading")}</p>}>
            <CharacterPreview
              look={{
                animal: animal.id,
                fur: draft.fur,
                furHex,
                shirtHex: clothingColorHex(draft.shirt),
                trousersHex: clothingColorHex(draft.trousers),
              }}
            />
          </Suspense>
        </div>
        <div className="hv-onb-carousel" role="group" aria-labelledby={animalLabelId} onKeyDown={onCarouselKey}>
          <button type="button" className="hv-onb-round" onClick={() => step(-1)} aria-label={t("onboarding.animal.prev")}>
            ‹
          </button>
          <div aria-live="polite">
            <span id={animalLabelId} className="hv-onb-visually-hidden">
              {t("onboarding.animal.label")}
            </span>
            <strong>{t(`animal.${draft.animal}`)}</strong>
            <small>{t("onboarding.animal.position", { index: index + 1, total: ANIMALS.length })}</small>
          </div>
          <button type="button" className="hv-onb-round" onClick={() => step(1)} aria-label={t("onboarding.animal.next")}>
            ›
          </button>
        </div>
      </div>

      <div className="hv-onb-fields">
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

        <div className="hv-onb-field">
          <fieldset>
            <legend>{t("onboarding.fur.label")}</legend>
            <div className="hv-onb-swatches">
              {animal.furTints.map((tint, i) => (
                <label key={tint.id} className="hv-onb-swatch" style={{ background: tint.hex }}>
                  <input
                    type="radio"
                    name="fur"
                    value={tint.id}
                    checked={draft.fur === tint.id}
                    onChange={() => onChange({ ...draft, fur: tint.id })}
                  />
                  <span className="hv-onb-visually-hidden">{t("onboarding.fur.option", { n: i + 1 })}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <ColorField label="onboarding.shirt.label" name="shirt" value={draft.shirt} onChange={(shirt) => onChange({ ...draft, shirt })} />
        <ColorField
          label="onboarding.trousers.label"
          name="trousers"
          value={draft.trousers}
          onChange={(trousers) => onChange({ ...draft, trousers })}
        />
      </div>
    </div>
  );
}
