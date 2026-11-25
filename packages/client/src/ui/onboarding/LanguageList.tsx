import type { Language } from "@hellovalley/shared";
import { useId, useMemo, useState } from "react";
import { languageDisplayName } from "../../i18n/i18n";
import { useI18n } from "../../i18n/I18nProvider";
import { filterLanguages, type PickerLanguage } from "./draft";

/**
 * A searchable list of languages (radio group): featured first, then everything else, with an
 * "experimental" badge on non-featured target languages (build plan M14).
 */
export function LanguageList({
  name,
  value,
  onChange,
  exclude = null,
  showExperimental = false,
  labelledBy,
}: {
  name: string;
  value: string | null;
  onChange: (code: string) => void;
  exclude?: string | null;
  showExperimental?: boolean;
  labelledBy: string;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const hintId = useId();
  const items = useMemo(
    () => filterLanguages(query, (l: Language) => languageDisplayName(l.code, locale, l.englishName), exclude),
    [query, locale, exclude],
  );
  const featured = items.filter((i) => i.language.tier === "featured");
  const rest = items.filter((i) => i.language.tier !== "featured");

  const option = ({ language: l, displayName }: PickerLanguage) => (
    <label key={l.code} className="hv-onb-option">
      <input
        type="radio"
        name={name}
        value={l.code}
        checked={value === l.code}
        onChange={() => onChange(l.code)}
        aria-describedby={showExperimental && l.tier === "experimental" ? hintId : undefined}
      />
      <span className="hv-onb-lang-names">
        <span className="hv-onb-lang-native" lang={l.code} dir={l.rtl ? "rtl" : "ltr"}>
          {l.nativeName}
        </span>
        {displayName !== l.nativeName ? <span className="hv-onb-lang-local">{displayName}</span> : null}
      </span>
      {showExperimental && l.tier === "experimental" ? (
        <span className="hv-onb-badge">{t("onboarding.lang.experimental")}</span>
      ) : null}
    </label>
  );

  return (
    <div>
      <label htmlFor={searchId} className="hv-onb-visually-hidden">
        {t("onboarding.search.label")}
      </label>
      <input
        id={searchId}
        className="hv-onb-search"
        type="search"
        value={query}
        placeholder={t("onboarding.search.placeholder")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter picks the only match instead of submitting the step.
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (items.length === 1) onChange(items[0]!.language.code);
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {showExperimental ? (
        <p id={hintId} className="hv-onb-hint" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {t("onboarding.lang.experimental")}: {t("onboarding.lang.experimentalHint")}
        </p>
      ) : null}
      <div className="hv-onb-langs" role="radiogroup" aria-labelledby={labelledBy}>
        {items.length === 0 ? (
          <p role="status">{t("onboarding.search.none", { query })}</p>
        ) : query.trim() !== "" ? (
          <div className="hv-onb-lang-grid">{items.map(option)}</div>
        ) : (
          <>
            {featured.length > 0 ? (
              <>
                <h3>{t("onboarding.lang.featured")}</h3>
                <div className="hv-onb-lang-grid">{featured.map(option)}</div>
              </>
            ) : null}
            <h3>{t("onboarding.lang.all")}</h3>
            <div className="hv-onb-lang-grid">{rest.map(option)}</div>
          </>
        )}
      </div>
    </div>
  );
}
