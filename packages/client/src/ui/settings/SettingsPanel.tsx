import { type CSSProperties, useEffect, useId, useMemo } from "react";
import { useStore } from "zustand";
import { AUDIO_CHANNELS, STYLE_IDS, type StyleId } from "@hellovalley/shared";
import { playSfx } from "../../audio/live";
import { setVolume, useVolumes } from "../../audio/volumeStore";
import { useI18n } from "../../i18n/I18nProvider";
import { preloadStyle } from "../../scene/stylePreload";
import { saveStyle } from "../../settings/saveStyle";
import { createStyleSwitcher, type StyleSwitcher } from "../../settings/styleSwitch";
import { dioramaStore, useDiorama } from "../../state/dioramaStore";

const panel: CSSProperties = {
  position: "fixed",
  top: 112,
  left: 8,
  width: 300,
  maxWidth: "calc(100vw - 16px)",
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(255, 250, 240, 0.96)",
  color: "#3d3a44",
  font: "14px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.2)",
  zIndex: 20,
};

const choice: CSSProperties = { display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 4px", borderRadius: 6, cursor: "pointer" };

let switcher: StyleSwitcher | null = null;
let switcherUid: string | null = null;

/** One switcher per signed-in player, kept across panel openings (a switch may still be loading). */
function styleSwitcherFor(uid: string): StyleSwitcher {
  if (!switcher || switcherUid !== uid) {
    switcherUid = uid;
    switcher = createStyleSwitcher({
      current: () => dioramaStore.getState().style,
      preload: (style) => preloadStyle(style),
      apply: (style) => dioramaStore.getState().setStyle(style),
      persist: (style) => saveStyle(uid, style),
    });
  }
  return switcher;
}

/**
 * The Settings panel (GDD §2: the town style can change any time). M34 adds the town style: a
 * choice loads that style's kit in the background while the current town stays on screen, then
 * swaps it in place and saves it to the profile. M35 adds the volume sliders (music, voices,
 * effects and ambience), saved per player on this device (audio/volumeStore). TODO(M37): quality,
 * tilt-shift and the target-language switcher.
 */
export function SettingsPanel({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { t } = useI18n();
  const headingId = useId();
  const sw = useMemo(() => styleSwitcherFor(uid), [uid]);
  const { pending, error } = useStore(sw.store);
  const style = useDiorama((s) => s.style);
  const volumes = useVolumes((s) => s.volumes);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown: StyleId = pending ?? style;
  return (
    <section style={panel} role="dialog" aria-labelledby={headingId}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: 16 }}>
          {t("settings.title")}
        </h2>
        <button type="button" onClick={onClose}>
          {t("settings.close")}
        </button>
      </div>
      <fieldset style={{ border: "none", margin: "8px 0 0", padding: 0 }} role="radiogroup">
        <legend style={{ fontWeight: 600, padding: 0 }}>{t("settings.style")}</legend>
        <p style={{ margin: "2px 0 6px", fontSize: 12, opacity: 0.75 }}>{t("settings.style.hint")}</p>
        {STYLE_IDS.map((id) => (
          <label key={id} style={{ ...choice, background: id === shown ? "rgba(120, 150, 110, 0.15)" : "transparent" }}>
            <input type="radio" name="town-style" value={id} checked={id === shown} onChange={() => void sw.select(id)} />
            <span>
              <strong>{t(`style.${id}`)}</strong>
              <br />
              <small>{t(`style.${id}.desc`)}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p role="status" aria-live="polite" style={{ margin: "6px 0 0", fontSize: 12, minHeight: 16 }}>
        {pending ? t("settings.style.loading", { style: t(`style.${pending}`) }) : error === "load" ? t("settings.style.loadError") : error === "save" ? t("settings.style.saveError") : ""}
      </p>
      <fieldset style={{ border: "none", margin: "8px 0 0", padding: 0 }}>
        <legend style={{ fontWeight: 600, padding: 0 }}>{t("settings.audio")}</legend>
        <p style={{ margin: "2px 0 6px", fontSize: 12, opacity: 0.75 }}>{t("settings.audio.hint")}</p>
        {AUDIO_CHANNELS.map((channel) => (
          <label key={channel} style={{ display: "grid", gridTemplateColumns: "1fr 140px 34px", alignItems: "center", gap: 8, padding: "3px 4px" }}>
            <span>{t(`settings.audio.${channel}`)}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(volumes[channel] * 100)}
              onChange={(e) => setVolume(channel, Number(e.currentTarget.value) / 100)}
              // Let the player hear the new effects level when they let go.
              onPointerUp={channel === "sfx" ? () => playSfx("ui.pop") : undefined}
            />
            <small style={{ textAlign: "right" }}>{Math.round(volumes[channel] * 100)}</small>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

export default SettingsPanel;
