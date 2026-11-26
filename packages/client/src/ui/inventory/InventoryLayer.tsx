import { type DragEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef } from "react";
import { HOTBAR_SLOT_INDEXES, HOTBAR_SLOTS, INVENTORY_SLOTS, type SlotEntry, TOTAL_SLOTS } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import type { LabelMap } from "../../labels/labelSource";
import { requestLabels, useLabelMap } from "../../labels/labelStore";
import { moveInventory } from "../../net/inventorySession";
import { type InventoryStore, inventoryStore, setInventoryOpen, useInventory } from "../../state/inventoryStore";
import { itemEnglish, itemIcon, itemName } from "../items/items";
import "./inventory.css";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Tab opens the bag only from the game itself (nothing focused, the canvas) or from the bag and
 * hotbar: inside another panel (the conversation, the notebook) Tab keeps moving the focus.
 */
function tabIsOurs(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  if (target === document.body || target === document.documentElement || target.tagName === "CANVAS") return true;
  return target.closest(".hv-bag, .hv-hotbar") !== null;
}

/** Slots per row in the bag grid (the hotbar is the fifth row: slot indexes 24–29). */
const COLUMNS = HOTBAR_SLOTS;

export interface InventoryLayerProps {
  store?: InventoryStore;
  /** Sends a move (default: `inventory:move` over the TownRoom). */
  move?: (from: number, to: number) => void;
}

/**
 * The inventory on screen (build plan M26, GDD §5.6, §10 "Tab inventory"): a hotbar of 6 slots on
 * the right edge (click to hold an item in hand: the rod equips it for fishing, M27; food and drink can be eaten, M29) with
 * the coins, and the bag panel (Tab) with the 24 bag slots and the hotbar as its last row. Items
 * show their target-language word (the M25 world labels; English until they load). Moving a stack:
 * click it and click the target, or drag it, or use the arrow keys and Enter. The server decides
 * every move (`inventory:move` → `inventory:state`); what shows is its answer.
 */
export function InventoryLayer({ store = inventoryStore, move = (from, to) => void moveInventory(from, to, store) }: InventoryLayerProps) {
  const { t, locale } = useI18n();
  const status = useInventory((s) => s.status, store);
  const open = useInventory((s) => s.open, store);
  const coins = useInventory((s) => s.coins, store);
  const slots = useInventory((s) => s.slots, store);
  const lang = useInventory((s) => s.lang, store);
  const held = useInventory((s) => s.held, store);
  const selected = useInventory((s) => s.selected, store);
  const refused = useInventory((s) => s.refused, store);
  const labels = useLabelMap(lang);
  const titleId = useId();
  const buttons = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    if (lang) requestLabels(lang);
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      if (e.code === "Tab" && !e.shiftKey && tabIsOurs(e.target)) {
        e.preventDefault();
        setInventoryOpen(!store.getState().open, store);
      } else if (e.code === "Escape" && store.getState().open && tabIsOurs(e.target)) {
        e.preventDefault();
        if (store.getState().held !== null) store.setState({ held: null });
        else setInventoryOpen(false, store);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  // Opening the bag puts the keyboard on its first slot.
  useEffect(() => {
    if (open) buttons.current.get(0)?.focus();
  }, [open]);

  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const name = (entry: SlotEntry) => itemName(entry.itemId, labels);

  const activate = (slot: number) => {
    const state = store.getState();
    if (!state.open) {
      // The hotbar outside the bag: hold that item in hand (or put it away).
      store.setState({ selected: state.selected === slot ? null : slot });
      return;
    }
    if (state.held === null) {
      if (bySlot.has(slot)) store.setState({ held: slot });
    } else if (state.held === slot) store.setState({ held: null });
    else move(state.held, slot);
  };

  const onSlotKey = (slot: number, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS };
    const d = step[e.key];
    if (d === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const row = Math.floor(slot / COLUMNS);
    let next = slot + d;
    if (Math.abs(d) === 1 && Math.floor(next / COLUMNS) !== row) return;
    next = Math.max(0, Math.min(TOTAL_SLOTS - 1, next));
    buttons.current.get(next)?.focus();
  };

  const slotProps = (slot: number) => ({
    slot,
    entry: bySlot.get(slot) ?? null,
    labels,
    showEnglish: locale === "en",
    held: held === slot,
    selected: selected === slot,
    onActivate: () => activate(slot),
    onKey: (e: ReactKeyboardEvent<HTMLButtonElement>) => onSlotKey(slot, e),
    onDragStart: () => store.setState({ held: slot }),
    onDrop: () => {
      const from = store.getState().held;
      if (from !== null && from !== slot) move(from, slot);
      else store.setState({ held: null });
    },
    bind: (el: HTMLButtonElement | null) => {
      if (el) buttons.current.set(slot, el);
      else buttons.current.delete(slot);
    },
  });

  const heldEntry = held !== null ? bySlot.get(held) : undefined;
  const selectedEntry = selected !== null ? bySlot.get(selected) : undefined;
  const coinText = coins !== null ? t("inventory.coins", { coins: String(coins) }) : "…";
  let statusLine = "";
  if (heldEntry) statusLine = t("inventory.holding", { item: name(heldEntry) });
  else if (refused) statusLine = t(`inventory.refused.${refused}` as MessageKey);

  return (
    <>
      {!open ? (
        <div className="hv-hotbar" role="toolbar" aria-label={t("inventory.hotbar")} aria-orientation="vertical">
          <button type="button" className="hv-hotbar__bag" aria-expanded={false} aria-keyshortcuts="Tab" onClick={() => setInventoryOpen(true, store)}>
            🎒 <span className="hv-hotbar__label">{t("inventory.button")}</span>
          </button>
          <span className="hv-hotbar__coins" aria-label={coinText}>
            🪙 {coins ?? "…"}
          </span>
          {HOTBAR_SLOT_INDEXES.map((slot) => (
            <Slot key={slot} {...slotProps(slot)} compact />
          ))}
          {selectedEntry ? (
            <span className="hv-sr-only" role="status">
              {t("inventory.selected", { item: name(selectedEntry) })}
            </span>
          ) : null}
        </div>
      ) : (
        <section className="hv-bag" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <header className="hv-bag__header">
            <h2 id={titleId}>🎒 {t("inventory.title")}</h2>
            <span className="hv-bag__coins">🪙 {coinText}</span>
            <button type="button" onClick={() => setInventoryOpen(false, store)} aria-label={t("inventory.close")}>
              ✕
            </button>
          </header>
          {status === "offline" ? <p className="hv-bag__note">{t("inventory.offline")}</p> : null}
          <p className="hv-bag__note">{t("inventory.help")}</p>
          <div className="hv-bag__grid" role="group" aria-label={t("inventory.bag")}>
            {Array.from({ length: INVENTORY_SLOTS }, (_, slot) => (
              <Slot key={slot} {...slotProps(slot)} />
            ))}
          </div>
          <div className="hv-bag__grid hv-bag__grid--hotbar" role="group" aria-label={t("inventory.hotbar")}>
            {HOTBAR_SLOT_INDEXES.map((slot) => (
              <Slot key={slot} {...slotProps(slot)} />
            ))}
          </div>
          <p className="hv-bag__status" role="status">
            {statusLine}
          </p>
        </section>
      )}
    </>
  );
}

interface SlotProps {
  slot: number;
  entry: SlotEntry | null;
  labels: LabelMap | null;
  showEnglish: boolean;
  held: boolean;
  selected: boolean;
  compact?: boolean;
  onActivate: () => void;
  onKey: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onDragStart: () => void;
  onDrop: () => void;
  bind: (el: HTMLButtonElement | null) => void;
}

function Slot({ slot, entry, labels, showEnglish, held, selected, compact, onActivate, onKey, onDragStart, onDrop, bind }: SlotProps) {
  const { t } = useI18n();
  const word = entry ? itemName(entry.itemId, labels) : "";
  const reading = entry ? labels?.[`item.${entry.itemId}`]?.reading : undefined;
  const english = entry ? itemEnglish(entry.itemId) : "";
  let label = t("inventory.empty");
  if (entry) {
    label =
      showEnglish && english.toLowerCase() !== word.toLowerCase()
        ? t("inventory.slot.english", { item: word, english, qty: String(entry.qty) })
        : t("inventory.slot", { item: word, qty: String(entry.qty) });
  }
  const onDragOver = (e: DragEvent) => e.preventDefault();
  return (
    <button
      ref={bind}
      type="button"
      className={`hv-slot${compact ? " hv-slot--compact" : ""}${entry ? "" : " hv-slot--empty"}`}
      data-slot={slot}
      aria-label={label}
      aria-pressed={compact ? selected : held}
      title={entry ? [word, reading, showEnglish ? english : null].filter(Boolean).join(" · ") : undefined}
      draggable={entry !== null}
      onClick={onActivate}
      onKeyDown={onKey}
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/plain", String(slot));
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {entry ? (
        <>
          <span className="hv-slot__icon" aria-hidden="true">
            {itemIcon(entry.itemId)}
          </span>
          {!compact ? <span className="hv-slot__word">{word}</span> : null}
          {entry.qty > 1 ? <span className="hv-slot__qty">{entry.qty}</span> : null}
        </>
      ) : null}
    </button>
  );
}
