import { type CSSProperties, useEffect, useMemo, useState } from "react";
// Type-only: importing values from shared here would pull zod into the entry chunk.
import type { FurnitureId, FurnitureResultMessage, VisitStatusMessage } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { sendFurnitureEdit, useApartmentSession } from "../../net/apartmentSession";
import { answerVisit, closeIntercom, openIntercom, ringApartment, useVisitSession } from "../../net/visitSession";
import { placementStore, usePlacement } from "../../state/placementStore";
import { useWorld } from "../../state/worldStore";

const surface: CSSProperties = {
  borderRadius: 12,
  background: "rgba(255, 250, 240, 0.95)",
  color: "#3d3a44",
  font: "14px/1.4 system-ui, sans-serif",
  boxShadow: "0 2px 12px rgba(0, 0, 0, 0.18)",
};

const prompt: CSSProperties = {
  ...surface,
  position: "fixed",
  left: "50%",
  bottom: 24,
  transform: "translateX(-50%)",
  padding: "8px 16px",
  border: 0,
  borderRadius: 999,
  font: "600 14px/1.4 system-ui, sans-serif",
  cursor: "pointer",
};

const panel: CSSProperties = {
  ...surface,
  position: "fixed",
  right: 12,
  bottom: 12,
  width: "min(340px, calc(100vw - 24px))",
  maxHeight: "calc(100vh - 24px)",
  overflowY: "auto",
  padding: "12px 14px",
  display: "grid",
  gap: 8,
};

const toasts: CSSProperties = {
  position: "fixed",
  left: "50%",
  top: 12,
  transform: "translateX(-50%)",
  display: "grid",
  gap: 8,
  width: "min(420px, calc(100vw - 24px))",
};

const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" };

const furnitureName = (t: (key: MessageKey) => string, id: string) => t(`furniture.${id}` as MessageKey);

/**
 * The apartment and visit HUD (build plan M17): the intercom prompt and panel at the apartment
 * block door, requests ringing at the player's own apartment (accept / decline), the status of
 * the player's own request, and the Decorate button plus placement panel at home.
 */
export function ApartmentHud() {
  return (
    <>
      <IntercomLayer />
      <VisitToasts />
      <PlacementLayer />
    </>
  );
}

function IntercomLayer() {
  const { t } = useI18n();
  const nearby = useWorld((s) => s.nearby);
  const open = useVisitSession((s) => s.intercomOpen);
  const players = useVisitSession((s) => s.players);
  const outgoing = useVisitSession((s) => s.outgoing);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") closeIntercom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // Walking away closes the panel.
  useEffect(() => {
    if (open && nearby?.kind !== "intercom") closeIntercom();
  }, [open, nearby]);

  if (!open) {
    if (nearby?.kind !== "intercom") return null;
    return (
      <button type="button" style={prompt} aria-label={t("interact.intercom.button")} onClick={openIntercom}>
        {t("interact.intercom")}
      </button>
    );
  }
  const ringing = outgoing?.state === "pending";
  return (
    <section role="dialog" aria-label={t("intercom.title")} style={panel}>
      <strong style={{ fontSize: 16 }}>{t("intercom.title")}</strong>
      <span style={{ fontSize: 13, opacity: 0.8 }}>{t("intercom.hint")}</span>
      {players === null ? <span>{t("intercom.loading")}</span> : null}
      {players?.length === 0 ? <span>{t("intercom.empty")}</span> : null}
      {players && players.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {players.map((p) => (
            <li key={p.sessionId} style={row}>
              <span>
                {t("intercom.entry", { name: p.name, apartment: p.apartmentId })}
                <span style={{ fontSize: 12, opacity: 0.7 }}> · {t(p.home ? "intercom.home" : "intercom.away")}</span>
              </span>
              <button type="button" disabled={ringing} onClick={() => ringApartment(p.sessionId)}>
                {t("intercom.ring")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {outgoing ? <span role="status">{visitStatusText(t, outgoing)}</span> : null}
      <div style={row}>
        <button type="button" onClick={openIntercom}>
          {t("common.retry")}
        </button>
        <button type="button" onClick={closeIntercom}>
          {t("intercom.close")}
        </button>
      </div>
    </section>
  );
}

function visitStatusText(t: ReturnType<typeof useI18n>["t"], s: VisitStatusMessage): string {
  const params = { name: s.ownerName, apartment: s.apartmentId };
  switch (s.state) {
    case "pending":
      return t("visit.pending", params);
    case "accepted":
      return t("visit.accepted", params);
    case "declined":
      return t("visit.declined", params);
    case "expired":
      return t("visit.expired", params);
    default:
      return t("visit.unavailable");
  }
}

/** How long the answer to the player's own request stays on screen. */
const STATUS_TOAST_MS = 4000;

function VisitToasts() {
  const { t } = useI18n();
  const incoming = useVisitSession((s) => s.incoming);
  const outgoing = useVisitSession((s) => s.outgoing);
  const intercomOpen = useVisitSession((s) => s.intercomOpen);
  const [hidden, setHidden] = useState<string | null>(null);
  // Answers show for a few seconds (the panel shows them too while it is open).
  useEffect(() => {
    if (!outgoing || outgoing.state === "pending") return;
    const timer = setTimeout(() => setHidden(outgoing.requestId + outgoing.state), STATUS_TOAST_MS);
    return () => clearTimeout(timer);
  }, [outgoing]);
  const showOutgoing = outgoing && !intercomOpen && hidden !== outgoing.requestId + outgoing.state;
  if (incoming.length === 0 && !showOutgoing) return null;
  return (
    <div style={toasts}>
      {incoming.map((r) => (
        <div key={r.requestId} role="alertdialog" aria-label={t("intercom.title")} style={{ ...surface, padding: "10px 14px", display: "grid", gap: 8 }}>
          <span>{t("visit.incoming", { name: r.fromName, apartment: r.fromApartment })}</span>
          <div style={{ ...row, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => answerVisit(r.requestId, false)}>
              {t("visit.decline")}
            </button>
            <button type="button" onClick={() => answerVisit(r.requestId, true)}>
              {t("visit.accept")}
            </button>
          </div>
        </div>
      ))}
      {showOutgoing ? (
        <div role="status" style={{ ...surface, padding: "8px 14px" }}>
          {visitStatusText(t, outgoing)}
        </div>
      ) : null}
    </div>
  );
}

function resultText(t: ReturnType<typeof useI18n>["t"], r: FurnitureResultMessage): string {
  if (r.reason === "invalid") return t("placement.error.invalid");
  if (r.reason === "fixed") return t("placement.error.fixed");
  return t("placement.error.other");
}

/** The stored pieces of a layout JSON (server-validated; only the ids are read here). */
function storedOf(json: string | null): string[] {
  if (!json) return [];
  try {
    const stored = (JSON.parse(json) as { stored?: unknown }).stored;
    return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function PlacementLayer() {
  const { t } = useI18n();
  const space = useWorld((s) => s.space);
  const isOwner = useApartmentSession((s) => s.isOwner);
  const layoutJson = useApartmentSession((s) => s.layoutJson);
  const lastResult = useApartmentSession((s) => s.lastResult);
  const open = usePlacement((s) => s.open);
  const held = usePlacement((s) => s.held);
  const stored = useMemo(() => storedOf(layoutJson), [layoutJson]);
  // The latest refusal stays until the next edit's answer replaces it.
  const shownResult = lastResult && !lastResult.ok ? lastResult : null;
  const home = space === "apartment" && isOwner;
  // Leaving home (or losing ownership of the view) closes placement mode.
  useEffect(() => {
    if (!home && placementStore.getState().open) placementStore.getState().setOpen(false);
  }, [home]);
  if (!home) return null;
  const s = placementStore.getState();
  if (!open) {
    return (
      <button type="button" style={{ ...prompt, left: "auto", right: 12, transform: "none" }} onClick={() => s.setOpen(true)}>
        {t("placement.open")}
      </button>
    );
  }
  return (
    <section aria-label={t("placement.title")} style={panel}>
      <div style={row}>
        <strong style={{ fontSize: 16 }}>{t("placement.title")}</strong>
        <button type="button" onClick={() => s.setOpen(false)}>
          {t("placement.done")}
        </button>
      </div>
      <span style={{ fontSize: 13, opacity: 0.8 }}>{t("placement.hint")}</span>
      {held ? (
        <div style={{ display: "grid", gap: 6 }}>
          <span>{t("placement.holding", { item: furnitureName(t, held.itemId) })}</span>
          <div style={row}>
            <button type="button" onClick={() => s.rotate()}>
              {t("placement.rotate")}
            </button>
            {held.kind === "placed" ? (
              <button
                type="button"
                onClick={() => {
                  sendFurnitureEdit({ op: "store", index: held.index, itemId: held.itemId });
                  s.hold(null);
                }}
              >
                {t("placement.store")}
              </button>
            ) : null}
            <button type="button" onClick={() => s.hold(null)}>
              {t("placement.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {shownResult ? (
        <span role="alert" style={{ color: "#a33a3a" }}>
          {resultText(t, shownResult)}
        </span>
      ) : null}
      <strong>{t("placement.storage")}</strong>
      {stored.length === 0 ? <span style={{ opacity: 0.75 }}>{t("placement.storage.empty")}</span> : null}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {[...new Set(stored)].map((id) => (
          <li key={id} style={row}>
            <span>
              {furnitureName(t, id)}
              {stored.filter((x) => x === id).length > 1 ? ` × ${stored.filter((x) => x === id).length}` : ""}
            </span>
            <button type="button" onClick={() => s.hold({ kind: "stored", itemId: id as FurnitureId })}>
              {t("placement.place")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
