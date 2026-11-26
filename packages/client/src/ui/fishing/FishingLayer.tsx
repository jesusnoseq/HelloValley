import { type PointerEvent as ReactPointerEvent, useEffect, useMemo } from "react";
import { REEL_PARAMS, zoneCentre } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { sendCast, sendReel } from "../../net/fishingSession";
import { useAvatar } from "../../state/avatarStore";
import { chat } from "../../net/chatSession";
import { conversationStore } from "../../state/conversationStore";
import { fishingLive, type FishingStore, fishingStore, useFishing } from "../../state/fishingStore";
import { type InventoryStore, inventoryStore, useInventory } from "../../state/inventoryStore";
import { notebookStore } from "../../state/notebookStore";
import { useWorld } from "../../state/worldStore";
import { CatchCard } from "./CatchCard";
import { createFishingController, type FishingController } from "./controller";
import { FishBook } from "./FishBook";
import "./fishing.css";
import { isAction } from "../../settings/settingsStore";
import { useActionKey } from "../../settings/keyNames";

/** Space belongs to text fields and to buttons of other panels; the hotbar's and ours are fine. */
function spaceIsTaken(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.tagName === "BUTTON" && target.closest(".hv-hotbar, .hv-fishing") === null;
}

/** The hotbar slot whose item in hand is the fishing rod, or null. */
export function rodSlot(inv: Pick<ReturnType<InventoryStore["getState"]>, "selected" | "slots">): number | null {
  if (inv.selected === null) return null;
  return inv.slots.some((s) => s.slot === inv.selected && s.itemId === "fishing_rod") ? inv.selected : null;
}

/** Another panel has the player's attention. */
function otherPanelOpen(): boolean {
  return inventoryStore.getState().open || notebookStore.getState().open || chat.store.getState().typing || conversationStore.getState().phase !== "idle";
}

export interface FishingLayerProps {
  store?: FishingStore;
  inventory?: InventoryStore;
  controller?: FishingController;
}

/**
 * Fishing on screen (build plan M27, GDD §5.2): with the rod in hand (a hotbar slot, M26) at the
 * dock or a river bank, Space (or the on-screen button) casts, hooks and reels; the hint at the
 * bottom says what to do, the reel bar shows the moving zone and the bobber, and a landed fish
 * shows its catch card. The fish book button opens the encyclopedia the server keeps. The
 * steering is `controller.ts`; the line and the shadow in the river are scene/FishingLine.tsx.
 */
export function FishingLayer({ store = fishingStore, inventory = inventoryStore, controller: injected }: FishingLayerProps) {
  const { t } = useI18n();
  const useKey = useActionKey("use");
  const phase = useFishing((s) => s.phase, store);
  const notice = useFishing((s) => s.notice, store);
  const cast = useFishing((s) => s.cast, store);
  const bookOpen = useFishing((s) => s.bookOpen, store);
  const logLoaded = useFishing((s) => s.logLoaded, store);
  const slot = useInventory((s) => rodSlot(s), inventory);
  const space = useWorld((s) => s.space);
  const spot = useWorld((s) => s.fishingSpot);
  const lang = useAvatar((s) => s.profile?.targetLangs[0] ?? null);
  const nativeLang = useAvatar((s) => s.profile?.nativeLang ?? "en");

  const controller = useMemo(
    () =>
      injected ??
      createFishingController({
        store,
        sendCast: (m) => sendCast(m),
        sendReel: (m) => sendReel(m),
        rodSlot: () => rodSlot(inventory.getState()),
        where: () => (fishingLive.pos ? { pos: fishingLive.pos, heading: fishingLive.heading } : null),
        canCast: () => !otherPanelOpen(),
      }),
    [injected, store, inventory],
  );

  const engaged = phase !== "idle" && phase !== "result";
  const ready = slot !== null && space === "town";

  // Space: hold to cast, press to hook, hold to reel. Escape reels in.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        if (store.getState().phase !== "idle") {
          controller.cancel();
          e.preventDefault();
        }
        return;
      }
      if (!isAction(e, "use") || e.ctrlKey || e.metaKey || e.altKey || spaceIsTaken(e.target)) return;
      const s = store.getState();
      if (s.phase === "idle" && (rodSlot(inventory.getState()) === null || otherPanelOpen())) return;
      if (s.phase === "result" || s.bookOpen) return;
      e.preventDefault();
      if (!e.repeat) controller.press();
    };
    const up = (e: KeyboardEvent) => {
      if (!isAction(e, "use")) return;
      // A focused hotbar button would otherwise toggle the rod on key-up.
      if (store.getState().phase !== "idle" && !spaceIsTaken(e.target)) e.preventDefault();
      controller.release();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [controller, store, inventory]);

  // The bite and the reel run every frame while the line is out.
  useEffect(() => {
    if (!engaged) return;
    let frame = requestAnimationFrame(function loop() {
      controller.tick();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [engaged, controller]);

  const pointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    controller.press();
  };
  const pointerUp = () => controller.release();

  return (
    <>
      {logLoaded ? (
        <button type="button" className="hv-fishbook-button" aria-expanded={bookOpen} onClick={() => store.setState({ bookOpen: !bookOpen })}>
          📖🐟 <span>{t("fishing.book.button")}</span>
        </button>
      ) : null}
      {ready || engaged ? (
        <div className="hv-fishing" role="region" aria-label={t("fishing.reel.bar")} aria-live="polite">
          {phase === "idle" ? (
            <>
              {notice ? <p className="hv-fishing__notice">{t(`fishing.notice.${notice}` as MessageKey)}</p> : null}
              {spot ? (
                <>
                  <p>{t("fishing.hint.cast", { key: useKey.name })}</p>
                  <button type="button" className="hv-fishing__button" aria-keyshortcuts={useKey.aria} onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerLeave={pointerUp}>
                    🎣 {t("fishing.button.cast")}
                  </button>
                </>
              ) : (
                <p>{t("fishing.hint.noSpot")}</p>
              )}
            </>
          ) : null}
          {phase === "charging" ? <ChargeMeter store={store} label={t("fishing.charge")} /> : null}
          {phase === "casting" ? <p>{t("fishing.casting")}</p> : null}
          {phase === "waiting" && cast ? (
            <>
              <p>{t("fishing.waiting")}</p>
              <p className="hv-fishing__shadow">{t(`fishing.shadow.${cast.shadow}` as MessageKey)}</p>
            </>
          ) : null}
          {phase === "bite" ? (
            <>
              <p className="hv-fishing__bite" role="alert">
                {t("fishing.bite", { key: useKey.name })}
              </p>
              <button type="button" className="hv-fishing__button hv-fishing__button--hook" aria-keyshortcuts={useKey.aria} onPointerDown={pointerDown} onPointerUp={pointerUp}>
                ❗ {t("fishing.button.hook")}
              </button>
            </>
          ) : null}
          {phase === "reeling" ? (
            <>
              <p>{t("fishing.reel", { key: useKey.name })}</p>
              <ReelBar store={store} label={t("fishing.reel.bar")} progressLabel={t("fishing.reel.progress")} />
              <button type="button" className="hv-fishing__button" aria-keyshortcuts={useKey.aria} onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerLeave={pointerUp}>
                🎣 {t("fishing.button.reel")}
              </button>
            </>
          ) : null}
          {phase === "landing" ? <p>{t("fishing.landing")}</p> : null}
          {engaged && phase !== "landing" && phase !== "casting" ? (
            <button type="button" className="hv-fishing__cancel" onClick={() => controller.cancel()}>
              {t("fishing.cancel")}
            </button>
          ) : null}
        </div>
      ) : null}
      {phase === "result" && lang ? <CatchCard store={store} lang={lang} nativeLang={nativeLang} onClose={() => controller.closeResult()} /> : null}
      {bookOpen && lang ? <FishBook store={store} lang={lang} nativeLang={nativeLang} /> : null}
    </>
  );
}

function ChargeMeter({ store, label }: { store: FishingStore; label: string }) {
  const start = useFishing((s) => s.chargeStartMs, store);
  // A CSS animation over CAST_CHARGE_MS fills the bar while the button is held.
  return (
    <div className="hv-fishing__charge" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} key={start ?? 0}>
      <span className="hv-fishing__charge-fill" />
    </div>
  );
}

function ReelBar({ store, label, progressLabel }: { store: FishingStore; label: string; progressLabel: string }) {
  const reel = useFishing((s) => s.reel, store);
  const cast = useFishing((s) => s.cast, store);
  if (!reel || !cast) return null;
  const params = REEL_PARAMS[cast.rarity];
  const centre = zoneCentre(reel.t, params, cast.reelSeed);
  const pct = (v: number) => `${(Math.min(1, Math.max(0, v)) * 100).toFixed(1)}%`;
  return (
    <div className="hv-reel">
      <div className="hv-reel__bar" aria-label={label} role="img">
        <span className="hv-reel__zone" style={{ bottom: pct(centre - params.zoneSize / 2), height: pct(params.zoneSize) }} />
        <span className="hv-reel__bobber" style={{ bottom: pct(reel.pos) }} />
      </div>
      <div className="hv-reel__progress" role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(reel.progress * 100)}>
        <span style={{ height: pct(reel.progress) }} />
      </div>
    </div>
  );
}
