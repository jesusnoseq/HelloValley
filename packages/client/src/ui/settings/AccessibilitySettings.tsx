import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/i18n";
import { DEFAULT_KEYMAP, GAME_ACTIONS, type GameAction } from "../../input/keymap";
import { keyName } from "../../settings/keyNames";
import { MOTION_PREFS, QUALITY_LEVELS, reducesMotion, renderOptions, TEXT_SIZE_IDS } from "../../settings/playerSettings";
import { rebindAction, updateSettings, useSettings } from "../../settings/settingsStore";

/**
 * Accessibility, graphics and key settings (build plan M37), saved per player on this device
 * (settings/settingsStore). Text size scales the HUD and panels; the colour-blind set swaps the UI
 * accents; reduced motion follows the system unless forced, and turns off tilt-shift, camera easing
 * and UI animations; captions cannot be turned off (every voice line is shown as text); keys are
 * remapped by pressing the new key.
 */

const fieldset: CSSProperties = { border: "none", margin: "10px 0 0", padding: 0 };
const legend: CSSProperties = { fontWeight: 600, padding: 0 };
const hint: CSSProperties = { margin: "2px 0 6px", fontSize: 12, opacity: 0.8 };
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", padding: "4px 4px", minHeight: 24, cursor: "pointer" };

export function AccessibilitySettings() {
  const { t } = useI18n();
  const settings = useSettings((s) => s.settings);
  const system = useSettings((s) => s.systemReducedMotion);
  const render = renderOptions(settings, system);
  return (
    <>
      <fieldset style={fieldset}>
        <legend style={legend}>{t("settings.access")}</legend>
        <fieldset style={{ ...fieldset, marginTop: 4 }}>
          <legend style={{ fontSize: 13, padding: 0 }}>{t("settings.textSize")}</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {TEXT_SIZE_IDS.map((id) => (
              <label key={id} style={row}>
                <input type="radio" name="text-size" value={id} checked={settings.textSize === id} onChange={() => updateSettings({ textSize: id })} />
                <span>{t(`settings.textSize.${id}` as MessageKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label style={{ ...row, alignItems: "flex-start" }}>
          <input type="checkbox" checked={settings.accents === "colorblind"} onChange={(e) => updateSettings({ accents: e.currentTarget.checked ? "colorblind" : "cozy" })} />
          <span>
            {t("settings.accents")}
            <br />
            <small style={{ opacity: 0.8 }}>{t("settings.accents.hint")}</small>
          </span>
        </label>
        <fieldset style={{ ...fieldset, marginTop: 4 }}>
          <legend style={{ fontSize: 13, padding: 0 }}>{t("settings.motion")}</legend>
          <p style={hint}>{t("settings.motion.hint")}</p>
          {MOTION_PREFS.map((id) => (
            <label key={id} style={row}>
              <input type="radio" name="motion" value={id} checked={settings.motion === id} onChange={() => updateSettings({ motion: id })} />
              <span>{id === "system" ? t("settings.motion.system", { state: t(system ? "settings.motion.on" : "settings.motion.off") }) : t(`settings.motion.${id}`)}</span>
            </label>
          ))}
        </fieldset>
        <label style={row}>
          <input type="checkbox" checked={settings.micButton} onChange={(e) => updateSettings({ micButton: e.currentTarget.checked })} />
          <span>{t("settings.mic")}</span>
        </label>
        <p style={hint}>{t("settings.captions")}</p>
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>{t("settings.graphics")}</legend>
        {QUALITY_LEVELS.map((id) => (
          <label key={id} style={row}>
            <input type="radio" name="quality" value={id} checked={settings.quality === id} onChange={() => updateSettings({ quality: id })} />
            <span>{t(`settings.quality.${id}`)}</span>
          </label>
        ))}
        <label style={row}>
          <input
            type="checkbox"
            checked={render.tiltShift}
            disabled={settings.quality === "low" || reducesMotion(settings, system)}
            aria-describedby={render.tiltShift || !settings.tiltShift ? undefined : "hv-tiltshift-off"}
            onChange={(e) => updateSettings({ tiltShift: e.currentTarget.checked })}
          />
          <span>{t("settings.tiltShift")}</span>
        </label>
        {settings.quality === "low" || reducesMotion(settings, system) ? (
          <p id="hv-tiltshift-off" style={hint}>
            {t("settings.tiltShift.off")}
          </p>
        ) : null}
      </fieldset>

      <KeySettings />
    </>
  );
}

/** One button per game action; activating one waits for the next key press (Esc cancels). */
function KeySettings() {
  const { t } = useI18n();
  const keymap = useSettings((s) => s.settings.keymap);
  const [waiting, setWaiting] = useState<GameAction | null>(null);
  const [message, setMessage] = useState("");
  const buttons = useRef(new Map<GameAction, HTMLButtonElement>());

  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => {
      // Captured before the game and the panel see it.
      e.preventDefault();
      e.stopImmediatePropagation();
      const action = waiting;
      setWaiting(null);
      buttons.current.get(action)?.focus();
      if (e.code === "Escape") {
        setMessage("");
        return;
      }
      const before = keymap[action];
      const result = rebindAction(action, e.code);
      if (!result.ok) setMessage(t("settings.keys.reserved", { key: keyName(t, e.code) }));
      else if (result.swappedWith) {
        setMessage(t("settings.keys.swapped", { key: keyName(t, e.code), other: t(`action.${result.swappedWith}`), old: keyName(t, before) }));
      } else setMessage("");
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [waiting, keymap, t]);

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>{t("settings.keys")}</legend>
      <p style={hint}>{t("settings.keys.hint")}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 8px", alignItems: "center" }}>
        {GAME_ACTIONS.map((action) => (
          <KeyRow key={action} action={action} code={keymap[action]} waiting={waiting === action} onPick={() => setWaiting(action)} bind={(el) => (el ? buttons.current.set(action, el) : buttons.current.delete(action))} />
        ))}
      </div>
      <p role="status" aria-live="polite" style={{ ...hint, minHeight: 16 }}>
        {waiting ? t("settings.keys.waiting", { action: t(`action.${waiting}`) }) : message}
      </p>
      <button
        type="button"
        onClick={() => {
          updateSettings({ keymap: DEFAULT_KEYMAP });
          setMessage("");
        }}
      >
        {t("settings.keys.reset")}
      </button>
    </fieldset>
  );
}

function KeyRow({ action, code, waiting, onPick, bind }: { action: GameAction; code: string; waiting: boolean; onPick: () => void; bind: (el: HTMLButtonElement | null) => void }) {
  const { t } = useI18n();
  const label = t(`action.${action}`);
  const name = keyName(t, code);
  return (
    <>
      <span id={`hv-key-${action}`}>{label}</span>
      <button ref={bind} type="button" aria-pressed={waiting} aria-label={t("settings.keys.change", { action: label, key: name })} onClick={onPick} style={{ minWidth: 64 }}>
        <kbd>{waiting ? "…" : name}</kbd>
      </button>
    </>
  );
}
