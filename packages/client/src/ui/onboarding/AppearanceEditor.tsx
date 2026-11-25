import { ANIMALS, clothingColorHex, getAnimal } from "@hellovalley/shared";
import { type KeyboardEvent, lazy, type ReactNode, Suspense, useId } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { ColorField } from "./ColorField";
import { type AppearanceDraft, cycleAnimal, setAnimal } from "./draft";

const CharacterPreview = lazy(() => import("./CharacterPreview"));

/**
 * The avatar look editor (GDD §3): an animal carousel with a live 3D preview, the animal's natural
 * fur tints, and shirt and trousers colours (swatches plus the pastel-clamped HSL picker). Used by
 * onboarding's character step (M14) and by the apartment mirror (M15). `fields` adds controls
 * above the colours (the name field during onboarding).
 */
export function AppearanceEditor<D extends AppearanceDraft>({
  value,
  onChange,
  fields,
}: {
  value: D;
  onChange: (next: D) => void;
  fields?: ReactNode;
}) {
  const { t } = useI18n();
  const animalLabelId = useId();
  const furName = useId();
  const animal = getAnimal(value.animal) ?? ANIMALS[0];
  const index = ANIMALS.findIndex((a) => a.id === animal.id);
  const furHex = animal.furTints.find((f) => f.id === value.fur)?.hex ?? animal.furTints[0]!.hex;
  const step = (delta: number) => onChange(setAnimal(value, cycleAnimal(value.animal, delta)));
  const onCarouselKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
  };

  return (
    <div className="hv-onb-character">
      <div className="hv-onb-preview">
        <div className="hv-onb-stage" role="img" aria-label={`${t("onboarding.preview.label")}: ${t(`animal.${value.animal}`)}`}>
          <Suspense fallback={<p className="hv-onb-stage-msg">{t("onboarding.preview.loading")}</p>}>
            <CharacterPreview
              look={{
                animal: animal.id,
                fur: value.fur,
                furHex,
                shirtHex: clothingColorHex(value.shirt),
                trousersHex: clothingColorHex(value.trousers),
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
            <strong>{t(`animal.${value.animal}`)}</strong>
            <small>{t("onboarding.animal.position", { index: index + 1, total: ANIMALS.length })}</small>
          </div>
          <button type="button" className="hv-onb-round" onClick={() => step(1)} aria-label={t("onboarding.animal.next")}>
            ›
          </button>
        </div>
      </div>

      <div className="hv-onb-fields">
        {fields}

        <div className="hv-onb-field">
          <fieldset>
            <legend>{t("onboarding.fur.label")}</legend>
            <div className="hv-onb-swatches">
              {animal.furTints.map((tint, i) => (
                <label key={tint.id} className="hv-onb-swatch" style={{ background: tint.hex }}>
                  <input
                    type="radio"
                    name={furName}
                    value={tint.id}
                    checked={value.fur === tint.id}
                    onChange={() => onChange({ ...value, fur: tint.id })}
                  />
                  <span className="hv-onb-visually-hidden">{t("onboarding.fur.option", { n: i + 1 })}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <ColorField label="onboarding.shirt.label" name={`${furName}-shirt`} value={value.shirt} onChange={(shirt) => onChange({ ...value, shirt })} />
        <ColorField
          label="onboarding.trousers.label"
          name={`${furName}-trousers`}
          value={value.trousers}
          onChange={(trousers) => onChange({ ...value, trousers })}
        />
      </div>
    </div>
  );
}
