import { useEffect, useId, useRef, useState } from "react";
import { type BuffKind, getItem, getRecipe, isEdible, itemCounts, knownRecipeIds, planCooking, RECIPE_IDS, type RecipeId } from "@hellovalley/shared";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/messages.en";
import { requestLabels, useLabelMap } from "../../labels/labelStore";
import { sendCook, sendEat, sendSit, sendStand } from "../../net/foodSession";
import { chat } from "../../net/chatSession";
import { useAvatar } from "../../state/avatarStore";
import { conversationStore } from "../../state/conversationStore";
import { type FoodStore, foodStore, liveBuffs, useFood } from "../../state/foodStore";
import { fishingActive } from "../../state/fishingStore";
import { type InventoryStore, inventoryStore, useInventory } from "../../state/inventoryStore";
import { notebookStore } from "../../state/notebookStore";
import { useWorld } from "../../state/worldStore";
import { itemIcon, itemName } from "../items/items";
import { RecipeCard } from "./RecipeCard";
import "./food.css";

/** Notices fade after this long (ms). */
export const FOOD_NOTICE_MS = 4000;

const BUFF_ICONS: Record<BuffKind, string> = {
  walk_speed: "🏃",
  reply_hint: "💡",
  fishing_luck: "🎣",
  happy_emote: "😊",
  cosmetic_glow: "✨",
};

/** Space belongs to text fields and to buttons of other panels; the hotbar's and ours are fine. */
function spaceIsTaken(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return target.tagName === "BUTTON" && target.closest(".hv-hotbar, .hv-food") === null;
}

/** Another panel has the player's attention. */
function otherPanelOpen(inventory: InventoryStore): boolean {
  return inventory.getState().open || notebookStore.getState().open || chat.store.getState().typing || conversationStore.getState().phase !== "idle" || fishingActive();
}

/** The hotbar slot whose item in hand can be eaten, or null. */
export function edibleSlot(inv: Pick<ReturnType<InventoryStore["getState"]>, "selected" | "slots">): number | null {
  if (inv.selected === null) return null;
  const entry = inv.slots.find((s) => s.slot === inv.selected);
  return entry && isEdible(entry.itemId) ? inv.selected : null;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export interface FoodLayerProps {
  store?: FoodStore;
  inventory?: InventoryStore;
  /** The clock (tests fix it). */
  now?: () => number;
  eat?: (slot: number) => boolean;
  cook?: (recipeId: RecipeId) => boolean;
  sit?: (seatId: string) => boolean;
  stand?: () => boolean;
}

/**
 * Eating, sitting and cooking on screen (build plan M29, GDD §5.4): the buff HUD (top centre: each
 * running buff with its time left), "Eat (Space)" when a food is held in the hotbar, the server's
 * answer to a bite, "Sit down / Stand up (F)" next to a bench or café chair, and at the apartment
 * kitchen "Cook (F)" opens the kitchen with the recipe cards of every recipe the player learned,
 * written in the target language. The server decides every bite, seat and dish.
 */
export function FoodLayer({
  store = foodStore,
  inventory = inventoryStore,
  now = Date.now,
  eat = (slot) => sendEat(slot, store),
  cook = (recipeId) => sendCook(recipeId, store),
  sit = (seatId) => sendSit(seatId, store),
  stand = () => sendStand(store),
}: FoodLayerProps) {
  const { t } = useI18n();
  const buffs = useFood((s) => s.buffs, store);
  const lastEaten = useFood((s) => s.lastEaten, store);
  const lastCooked = useFood((s) => s.lastCooked, store);
  const seat = useFood((s) => s.seat, store);
  const nearbySeat = useFood((s) => s.nearbySeat, store);
  const seatRefused = useFood((s) => s.seatRefused, store);
  const kitchenOpen = useFood((s) => s.kitchenOpen, store);
  const book = useFood((s) => s.book, store);
  const cooking = useFood((s) => s.cooking, store);
  const eatingNow = useFood((s) => s.eating, store);
  const slot = useInventory((s) => edibleSlot(s), inventory);
  const slots = useInventory((s) => s.slots, inventory);
  const nearby = useWorld((s) => s.nearby);
  const lang = useAvatar((s) => s.profile?.targetLangs[0] ?? null);
  const labels = useLabelMap(lang);
  const [clock, setClock] = useState(now);
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (lang) requestLabels(lang);
  }, [lang]);
  // The HUD counts down once a second while a buff runs.
  useEffect(() => {
    if (buffs.length === 0) return;
    const first = setTimeout(() => setClock(now()), 0);
    const timer = setInterval(() => setClock(now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [buffs, now]);
  // Notices fade on their own.
  useEffect(() => {
    if (!lastEaten) return;
    const timer = setTimeout(() => {
      if (store.getState().lastEaten === lastEaten) store.setState({ lastEaten: null });
    }, FOOD_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [lastEaten, store]);
  useEffect(() => {
    if (!seatRefused) return;
    const timer = setTimeout(() => store.setState({ seatRefused: null }), FOOD_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [seatRefused, store]);
  // The kitchen closes when the player walks away from it.
  const atKitchen = nearby?.kind === "kitchen";
  useEffect(() => {
    if (kitchenOpen && !atKitchen) store.setState({ kitchenOpen: false });
  }, [kitchenOpen, atKitchen, store]);
  useEffect(() => {
    if (kitchenOpen) closeButton.current?.focus();
  }, [kitchenOpen]);

  // Space eats the food in hand; Escape closes the kitchen.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape" && store.getState().kitchenOpen) {
        e.preventDefault();
        store.setState({ kitchenOpen: false });
        return;
      }
      if (e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || spaceIsTaken(e.target)) return;
      const held = edibleSlot(inventory.getState());
      if (held === null || otherPanelOpen(inventory) || store.getState().kitchenOpen) return;
      e.preventDefault();
      eat(held);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [store, inventory, eat]);

  const name = (id: string) => itemName(id, labels);
  const heldEntry = slot !== null ? slots.find((s) => s.slot === slot) : undefined;
  const running = liveBuffs(buffs, clock);

  let notice: string | null = null;
  if (lastEaten?.ok) notice = t("food.yum", { item: name(lastEaten.itemId) });
  else if (lastEaten) notice = t(`food.refused.${lastEaten.reason}` as MessageKey);
  else if (seatRefused) notice = t(`food.sit.refused.${seatRefused}` as MessageKey);

  const hint =
    heldEntry || notice || seat || nearbySeat || (atKitchen && !kitchenOpen) ? (
      <div className="hv-food" role="status" aria-live="polite">
        {notice ? <p className={`hv-food__notice${lastEaten?.ok ? " hv-food__notice--ok" : ""}`}>{notice}</p> : null}
        {heldEntry ? (
          <p>
            <button type="button" aria-keyshortcuts="Space" disabled={eatingNow} onClick={() => eat(heldEntry.slot)}>
              {itemIcon(heldEntry.itemId)} {t(getItem(heldEntry.itemId)?.category === "drink" ? "food.drink" : "food.eat", { item: name(heldEntry.itemId) })}
            </button>
          </p>
        ) : null}
        {seat ? (
          <p>
            <button type="button" aria-keyshortcuts="F" onClick={() => stand()}>
              🪑 {t("food.stand")}
            </button>
          </p>
        ) : nearbySeat ? (
          <p>
            <button type="button" aria-keyshortcuts="F" onClick={() => sit(nearbySeat)}>
              🪑 {t("food.sit")}
            </button>
          </p>
        ) : null}
        {atKitchen && !kitchenOpen ? (
          <p>
            <button type="button" aria-keyshortcuts="F" onClick={() => store.setState({ kitchenOpen: true })}>
              🍳 {t("food.kitchen.open")}
            </button>
          </p>
        ) : null}
      </div>
    ) : null;

  const known = knownRecipeIds(book);
  const counts = itemCounts(slots);

  return (
    <>
      {running.length > 0 ? (
        <ul className="hv-buffs" aria-label={t("food.buffs")}>
          {running.map((b) => {
            const left = b.endsAt - clock;
            const what = t(`food.buff.${b.kind}` as MessageKey, { percent: String(Math.round(b.amount * 100)) });
            return (
              <li key={b.kind} className="hv-buff" title={t("food.buff.from", { item: name(b.itemId) })} style={{ ["--hv-buff-left" as string]: String(Math.max(0, Math.min(1, left / b.durationMs))) }}>
                <span aria-hidden="true">{BUFF_ICONS[b.kind]}</span> <span>{what}</span> <span className="hv-buff__time" aria-label={t("food.buff.left", { time: mmss(left) })}>
                  {mmss(left)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {hint}
      {kitchenOpen && lang ? (
        <section className="hv-kitchen" role="dialog" aria-modal="false" aria-labelledby={titleId}>
          <header className="hv-kitchen__header">
            <h2 id={titleId}>🍳 {t("food.kitchen.title")}</h2>
            <button ref={closeButton} type="button" aria-label={t("food.kitchen.close")} onClick={() => store.setState({ kitchenOpen: false })}>
              ✕
            </button>
          </header>
          {lastCooked ? (
            <p className="hv-kitchen__notice" role="status">
              {lastCooked.ok ? t("food.cook.ok", { item: name(lastCooked.itemId) }) : t(`food.cook.refused.${lastCooked.reason}` as MessageKey)}
            </p>
          ) : null}
          {known.length === 0 ? <p>{t("food.kitchen.empty")}</p> : null}
          <div className="hv-kitchen__cards">
            {known.map((id) => {
              const entry = book.known[id]!;
              const ready = planCooking(getRecipe(id)!, counts).ok;
              return (
                <RecipeCard
                  key={id}
                  recipeId={id}
                  lang={lang}
                  counts={counts}
                  footer={
                    <p className="hv-recipe__footer">
                      {t("food.kitchen.teacher", { name: t(`npc.name.${entry.teacher}` as MessageKey) })}
                      {entry.cooked > 0 ? ` · ${t("food.kitchen.cooked", { count: String(entry.cooked) })}` : ""}
                    </p>
                  }
                  action={
                    <button type="button" className="hv-recipe__cook" disabled={!ready || cooking} onClick={() => cook(id)} aria-label={`${t("food.kitchen.cook")}: ${name(getRecipe(id)!.result)}`}>
                      {t("food.kitchen.cook")}
                    </button>
                  }
                />
              );
            })}
          </div>
          {known.length < RECIPE_IDS.length && known.length > 0 ? <p className="hv-kitchen__more">{t("food.kitchen.more", { count: String(RECIPE_IDS.length - known.length) })}</p> : null}
        </section>
      ) : null}
    </>
  );
}

