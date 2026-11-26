import type { SfxId } from "@hellovalley/shared";
import { fishingStore, type FishingPhase } from "../state/fishingStore";
import { foodStore } from "../state/foodStore";
import { forageStore } from "../state/forageStore";
import { inventoryStore } from "../state/inventoryStore";
import { notebookStore } from "../state/notebookStore";
import { questStore } from "../state/questStore";

/**
 * Interaction effects from game state (build plan M35, GDD §11): coins when the purse changes,
 * the fishing cast, splash and reel, the cooking sizzle, a pick-up jingle, a page turn when a word
 * is saved, and a soft open/close as panels come and go. Read from the stores the game already
 * keeps (the server's answers), so no feature needs to know about audio.
 */
export interface SfxSnapshot {
  coins: number | null;
  fishing: FishingPhase;
  /** Identity of the last cooked dish answer (a new object = a new answer). */
  cooked: { ok: boolean } | null;
  forage: { ok: boolean } | null;
  saved: { outcome: string; at: number } | null;
  /** How many panels are open. */
  panels: number;
}

export function sfxForChange(prev: SfxSnapshot, next: SfxSnapshot): SfxId[] {
  const out: SfxId[] = [];
  if (prev.coins !== null && next.coins !== null && next.coins !== prev.coins) out.push("coins");
  if (next.fishing !== prev.fishing) {
    if (next.fishing === "casting") out.push("fish.cast");
    else if (next.fishing === "waiting" || next.fishing === "bite") out.push("fish.splash");
    else if (next.fishing === "reeling") out.push("fish.reel");
  }
  if (next.cooked !== prev.cooked && next.cooked?.ok) out.push("cook.sizzle");
  if (next.forage !== prev.forage && next.forage?.ok) out.push("pickup");
  if (next.saved !== prev.saved && next.saved?.outcome === "saved") out.push("page");
  if (next.panels > prev.panels) out.push("ui.open");
  else if (next.panels < prev.panels) out.push("ui.close");
  return out;
}

export function sfxSnapshot(): SfxSnapshot {
  const notebook = notebookStore.getState();
  const inventory = inventoryStore.getState();
  const food = foodStore.getState();
  const forage = forageStore.getState();
  const quests = questStore.getState();
  const fishing = fishingStore.getState();
  const panels = [notebook.open, inventory.open, food.kitchenOpen, forage.albumOpen, quests.boardOpen, quests.logOpen, fishing.bookOpen].filter(Boolean).length;
  return { coins: inventory.coins, fishing: fishing.phase, cooked: food.lastCooked, forage: forage.last, saved: notebook.lastSave, panels };
}

/** Watch the stores and play the effects; returns the unsubscribe. */
export function startGameSfx(play: (id: SfxId) => void): () => void {
  let prev = sfxSnapshot();
  const check = () => {
    const next = sfxSnapshot();
    for (const id of sfxForChange(prev, next)) play(id);
    prev = next;
  };
  const stops = [notebookStore, inventoryStore, foodStore, forageStore, questStore, fishingStore].map((s) => (s as { subscribe: (fn: () => void) => () => void }).subscribe(check));
  return () => {
    for (const stop of stops) stop();
  };
}
