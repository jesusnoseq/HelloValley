import {
  defaultStyleFor,
  getLanguage,
  type OnboardingRequestInput,
  type OnboardingResponse,
  type PlayerProfile,
  SELF_ASSESSMENTS,
  STYLE_IDS,
} from "@hellovalley/shared";
import { useEffect, useRef, useState } from "react";
import { checkOnDeviceAtLogin, startWarmUp } from "../../ai/client";
import { languageDisplayName, type MessageKey, uiLocaleFor, uiLocaleFromBrowser } from "../../i18n/i18n";
import { I18nProvider, useI18n } from "../../i18n/I18nProvider";
import { ApiError, postOnboarding, type TokenSource } from "../../net/api";
import { AiStatusChip } from "../AiStatusChip";
import { CharacterStep } from "./CharacterStep";
import {
  initialDraft,
  nameError,
  ONBOARDING_STEPS,
  type OnboardingDraft,
  setNativeLang,
  setStyle,
  setTargetLang,
  stepError,
  toRequest,
} from "./draft";
import { LanguageList } from "./LanguageList";
import "./onboarding.css";

/**
 * Onboarding after Google sign-in (GDD §2.1, build plan M14): native language → target language
 * → self-assessed level → character → town style, then `POST /api/onboarding` (the server assigns
 * the apartment) and the apartment number reveal. The UI switches to the chosen native language
 * as soon as it is picked (EN/ES catalogues, others fall back to EN).
 * Build plan M20: on mount it asks whether the on-device model is available; the click that opens
 * character creation starts its download (a user gesture is required), and a chip shows progress.
 * TODO(seeding tool, see pending.md M22): the intro cutscene (the Mayor's seeded welcome, voiced
 * with `VoiceControls`, the key, the camera pulling out of
 * the apartment window) follows the reveal.
 */
export type SubmitOnboarding = (request: OnboardingRequestInput) => Promise<OnboardingResponse>;

export default function Onboarding({
  user,
  onComplete,
  submit,
}: {
  user: TokenSource;
  onComplete: (profile: PlayerProfile) => void;
  /** Replaces the server call (the dev page). Defaults to `POST /api/onboarding` as `user`. */
  submit?: SubmitOnboarding;
}) {
  const browser = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  const [draft, setDraft] = useState<OnboardingDraft>(() => initialDraft(browser));
  const locale = draft.nativeLang ? uiLocaleFor(draft.nativeLang) : uiLocaleFromBrowser(browser);
  return (
    <I18nProvider locale={locale}>
      <Wizard
        submit={submit ?? ((request) => postOnboarding(user, request))}
        draft={draft}
        setDraft={setDraft}
        onComplete={onComplete}
      />
    </I18nProvider>
  );
}

type Submit = { state: "idle" } | { state: "sending" } | { state: "failed"; message: MessageKey } | { state: "done"; profile: PlayerProfile };

function Wizard({
  submit: submitRequest,
  draft,
  setDraft,
  onComplete,
}: {
  submit: SubmitOnboarding;
  draft: OnboardingDraft;
  setDraft: (d: OnboardingDraft) => void;
  onComplete: (profile: PlayerProfile) => void;
}) {
  const { t, locale } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [nameRejected, setNameRejected] = useState<string | null>(null);
  const [submit, setSubmit] = useState<Submit>({ state: "idle" });
  const heading = useRef<HTMLHeadingElement>(null);
  const step = ONBOARDING_STEPS[stepIndex]!;
  const last = stepIndex === ONBOARDING_STEPS.length - 1;

  // Architecture §5.2 warm-up: check the on-device model (and preload the AI chunk) at login.
  useEffect(() => {
    void checkOnDeviceAtLogin();
  }, []);

  // Move focus to the new step's heading so screen readers announce it.
  const done = submit.state === "done";
  useEffect(() => {
    heading.current?.focus();
  }, [stepIndex, done]);

  const langName = (code: string | null) => {
    const l = code ? getLanguage(code) : undefined;
    return l ? languageDisplayName(l.code, locale, l.englishName) : "";
  };

  const rejectedName = nameRejected !== null && nameRejected === draft.name.trim();
  const error: MessageKey | null = rejectedName && step === "character" ? "onboarding.name.rejected" : stepError(step, draft);

  const send = async () => {
    const request = toRequest(draft);
    if (!request) {
      setSubmit({ state: "failed", message: "onboarding.error.generic" });
      return;
    }
    setSubmit({ state: "sending" });
    try {
      const { profile } = await submitRequest(request);
      setSubmit({ state: "done", profile });
    } catch (err) {
      if (err instanceof ApiError && err.code === "name_rejected") {
        setNameRejected(request.name);
        setSubmit({ state: "idle" });
        setShowErrors(true);
        setStepIndex(ONBOARDING_STEPS.indexOf("character"));
        return;
      }
      console.error("onboarding:", err);
      const network = err instanceof ApiError && err.code === "network";
      setSubmit({ state: "failed", message: network ? "onboarding.error.network" : "onboarding.error.generic" });
    }
  };

  const next = () => {
    if (error) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (last) void send();
    else setStepIndex(stepIndex + 1);
    // Still inside the click: start the model download as character creation opens.
    if (stepIndex + 1 >= ONBOARDING_STEPS.indexOf("character")) startWarmUp();
  };

  const back = () => {
    setShowErrors(false);
    setStepIndex(Math.max(0, stepIndex - 1));
  };

  if (submit.state === "done") {
    const { profile } = submit;
    return (
      <main className="hv-onb">
        <section className="hv-onb-card hv-onb-reveal" aria-labelledby="hv-onb-reveal-title">
          <h2 id="hv-onb-reveal-title" ref={heading} tabIndex={-1}>
            {t("onboarding.apartment.title", { name: profile.name })}
          </h2>
          <p style={{ margin: 0 }}>{t("onboarding.apartment.body")}</p>
          <div className="hv-onb-door" aria-hidden="true">
            <span className="hv-onb-plate">{profile.apartmentId}</span>
          </div>
          <p className="hv-onb-visually-hidden">{profile.apartmentId}</p>
          <p className="hv-onb-hint">{t("onboarding.apartment.hint", { apartment: profile.apartmentId })}</p>
          <button type="button" className="hv-onb-primary" onClick={() => onComplete(profile)} autoFocus>
            {t("onboarding.apartment.enter")}
          </button>
        </section>
        <AiStatusChip />
      </main>
    );
  }

  const headingId = `hv-onb-${step}-title`;
  const titles: Record<typeof step, { title: string; hint: string }> = {
    native: { title: t("onboarding.native.title"), hint: t("onboarding.native.hint") },
    target: { title: t("onboarding.target.title"), hint: t("onboarding.target.hint") },
    level: {
      title: t("onboarding.level.title", { language: langName(draft.targetLang) }),
      hint: t("onboarding.level.hint"),
    },
    character: { title: t("onboarding.character.title"), hint: "" },
    style: {
      title: t("onboarding.style.title"),
      hint: t("onboarding.style.hint", { language: langName(draft.targetLang) }),
    },
  };
  const suggested = draft.targetLang ? defaultStyleFor(draft.targetLang) : null;
  const sending = submit.state === "sending";

  return (
    <main className="hv-onb">
      <form
        className="hv-onb-card"
        aria-labelledby={headingId}
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        <div className="hv-onb-top">
          <span>{t("onboarding.title")}</span>
          <span>{t("onboarding.progress", { step: stepIndex + 1, total: ONBOARDING_STEPS.length })}</span>
        </div>
        <ol className="hv-onb-dots" aria-hidden="true">
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s} data-done={i <= stepIndex} />
          ))}
        </ol>
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {titles[step].title}
        </h2>
        {titles[step].hint ? <p className="hv-onb-hint">{titles[step].hint}</p> : null}

        {step === "native" ? (
          <LanguageList
            name="native-lang"
            labelledBy={headingId}
            value={draft.nativeLang}
            onChange={(code) => setDraft(setNativeLang(draft, code))}
          />
        ) : null}

        {step === "target" ? (
          <LanguageList
            name="target-lang"
            labelledBy={headingId}
            value={draft.targetLang}
            exclude={draft.nativeLang}
            showExperimental
            onChange={(code) => setDraft(setTargetLang(draft, code))}
          />
        ) : null}

        {step === "level" ? (
          <fieldset className="hv-onb-choices" role="radiogroup" aria-labelledby={headingId}>
            {SELF_ASSESSMENTS.map((a) => (
              <label key={a.id} className="hv-onb-option">
                <input
                  type="radio"
                  name="level"
                  value={a.id}
                  checked={draft.selfAssessment === a.id}
                  onChange={() => setDraft({ ...draft, selfAssessment: a.id })}
                />
                <span>{t(`level.${a.id}`)}</span>
                <span className="hv-onb-cefr">{a.level}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {step === "character" ? (
          <CharacterStep
            draft={draft}
            onChange={setDraft}
            nameError={rejectedName ? "onboarding.name.rejected" : nameError(draft.name)}
            showNameError={showErrors || rejectedName}
          />
        ) : null}

        {step === "style" ? (
          <fieldset className="hv-onb-choices hv-onb-styles" role="radiogroup" aria-labelledby={headingId}>
            {STYLE_IDS.map((id) => (
              <label key={id} className="hv-onb-option">
                <input type="radio" name="style" value={id} checked={draft.style === id} onChange={() => setDraft(setStyle(draft, id))} />
                <span className="hv-onb-choice-text">
                  <strong>{t(`style.${id}`)}</strong>
                  <small>{t(`style.${id}.desc`)}</small>
                </span>
                {id === suggested ? <span className="hv-onb-badge">{t("onboarding.style.suggested")}</span> : null}
              </label>
            ))}
          </fieldset>
        ) : null}

        {showErrors && error && step !== "character" ? (
          <p className="hv-onb-error" role="alert">
            {t(error)}
          </p>
        ) : null}
        {submit.state === "failed" ? (
          <p className="hv-onb-error" role="alert">
            {t(submit.message)}
          </p>
        ) : null}

        <div className="hv-onb-nav">
          <button type="button" className="hv-onb-secondary" onClick={back} disabled={stepIndex === 0 || sending}>
            {t("common.back")}
          </button>
          <button type="submit" className="hv-onb-primary" disabled={sending} aria-busy={sending}>
            {sending ? t("onboarding.submitting") : last ? t("onboarding.finish") : t("common.next")}
          </button>
        </div>
      </form>
      <AiStatusChip />
    </main>
  );
}
