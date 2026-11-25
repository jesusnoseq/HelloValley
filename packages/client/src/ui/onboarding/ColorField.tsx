import {
  type ClothingColor,
  clampPastel,
  clothingColorHex,
  hexToHsl,
  type Hsl,
  PALETTE,
  PASTEL_LIGHTNESS,
  PASTEL_SATURATION,
} from "@hellovalley/shared";
import { useId } from "react";
import type { MessageKey } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import { isCustomColor } from "./draft";

/**
 * Shirt or trousers colour (GDD §3.3): the 16 pastel swatches plus an "advanced" HSL picker whose
 * sliders only span the pastel saturation and lightness range (clampPastel).
 */
export function ColorField({
  label,
  name,
  value,
  onChange,
}: {
  label: MessageKey;
  name: string;
  value: ClothingColor;
  onChange: (color: ClothingColor) => void;
}) {
  const { t } = useI18n();
  const legendId = useId();
  const custom = isCustomColor(value);
  const hsl: Hsl = custom ? value : clampPastel(hexToHsl(clothingColorHex(value)) ?? { h: 200, s: 0.45, l: 0.75 });
  const setHsl = (patch: Partial<Hsl>) => onChange(clampPastel({ ...hsl, ...patch }));

  const slider = (key: keyof Hsl, text: MessageKey, min: number, max: number, step: number) => {
    const id = `${legendId}-${key}`;
    return (
      <>
        <label htmlFor={id}>{t(text)}</label>
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={hsl[key]}
          onChange={(e) => setHsl({ [key]: Number(e.target.value) })}
        />
      </>
    );
  };

  return (
    <div className="hv-onb-field">
      <fieldset aria-labelledby={legendId}>
        <legend id={legendId}>{t(label)}</legend>
        <div className="hv-onb-swatches">
          {PALETTE.map((s) => (
            <label key={s.id} className="hv-onb-swatch" style={{ background: s.hex }} title={t(`swatch.${s.id}`)}>
              <input
                type="radio"
                name={name}
                value={s.id}
                checked={!custom && value.swatch === s.id}
                onChange={() => onChange({ swatch: s.id })}
              />
              <span className="hv-onb-visually-hidden">{t(`swatch.${s.id}`)}</span>
            </label>
          ))}
        </div>
        <label className="hv-onb-custom-toggle">
          <input type="radio" name={name} value="custom" checked={custom} onChange={() => onChange(hsl)} />
          <span
            aria-hidden="true"
            className="hv-onb-swatch"
            style={{ width: 20, height: 20, background: clothingColorHex(hsl) }}
          />
          {t("onboarding.color.custom")}
        </label>
        {custom ? (
          <div className="hv-onb-custom">
            {slider("h", "onboarding.color.hue", 0, 359, 1)}
            {slider("s", "onboarding.color.saturation", PASTEL_SATURATION.min, PASTEL_SATURATION.max, 0.01)}
            {slider("l", "onboarding.color.lightness", PASTEL_LIGHTNESS.min, PASTEL_LIGHTNESS.max, 0.01)}
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
