import type { Room } from "@colyseus/sdk";
// Values from shared that carry no zod (protocol/messages), so the entry chunk stays small.
import {
  type BuffsMessage,
  ClientMessage,
  type CookMakeMessage,
  EATING_ACTIVITY_MS,
  type CookResultMessage,
  type FoodEatenMessage,
  type FoodEatMessage,
  type RecipeBookMessage,
  type RecipeId,
  type SeatSitMessage,
  type SeatStateMessage,
  ServerMessage,
  type WireBuff,
} from "@hellovalley/shared";
import { type ClientBuff, type FoodStore, foodStore, initialFoodState } from "../state/foodStore";
import { townLive, townSession } from "./townSession";

/**
 * The client side of eating, sitting and cooking (build plan M29) over the TownRoom: `buffs:state`,
 * `recipes:book`, `seat:state`, `food:eaten` and `cook:result` are mirrored into `foodStore`; the
 * senders ask the server, which checks the slot, the seat and the kitchen against its own records.
 */

const toClient = (b: WireBuff, now: number): ClientBuff => ({ kind: b.kind, amount: b.amount, itemId: b.itemId, endsAt: now + b.remainingMs, durationMs: b.durationMs });

/** Mirrors the room's food messages into the store until the returned function is called. */
export function attachFood(room: Room, store: FoodStore = foodStore, now: () => number = Date.now): () => void {
  const keep = () => ({ kitchenOpen: store.getState().kitchenOpen });
  store.setState({ ...initialFoodState(), ...keep() });
  const offs = [
    room.onMessage(ServerMessage.Buffs, (msg: BuffsMessage) => {
      const t = now();
      store.setState({ buffs: msg.buffs.map((b) => toClient(b, t)) });
    }),
    room.onMessage(ServerMessage.RecipeBook, (msg: RecipeBookMessage) => store.setState({ book: msg.book, bookLoaded: true })),
    room.onMessage(ServerMessage.FoodEaten, (msg: FoodEatenMessage) => {
      store.setState({ lastEaten: msg, eating: false, ...(msg.ok ? { eatingUntil: now() + EATING_ACTIVITY_MS } : {}) });
      // The cake's cheer plays on the local avatar too (the server relays it to everyone else).
      if (msg.ok && msg.emote) townLive.emotes.set(room.sessionId, [...(townLive.emotes.get(room.sessionId) ?? []), msg.emote].slice(-2));
    }),
    room.onMessage(ServerMessage.CookResult, (msg: CookResultMessage) => store.setState({ lastCooked: msg, cooking: false })),
    room.onMessage(ServerMessage.SeatState, (msg: SeatStateMessage) => store.setState({ seat: msg.seatId, seatRefused: msg.refused ?? null })),
  ];
  return () => {
    for (const off of offs) off();
    store.setState({ ...initialFoodState(), ...keep() });
  };
}

const open = (room: Room | null): room is Room => room?.connection.isOpen === true;

/** `food:eat` for a hotbar slot. False without an open room or while a bite is on its way. */
export function sendEat(slot: number, store: FoodStore = foodStore, room: Room | null = townSession.getState().room): boolean {
  if (!open(room) || store.getState().eating) return false;
  store.setState({ eating: true, lastEaten: null });
  const message: FoodEatMessage = { slot };
  room.send(ClientMessage.FoodEat, message);
  return true;
}

/** `cook:make` for a known recipe. */
export function sendCook(recipeId: RecipeId, store: FoodStore = foodStore, room: Room | null = townSession.getState().room): boolean {
  if (!open(room) || store.getState().cooking) return false;
  store.setState({ cooking: true, lastCooked: null });
  const message: CookMakeMessage = { recipeId };
  room.send(ClientMessage.CookMake, message);
  return true;
}

/** `seat:sit`. */
export function sendSit(seatId: string, store: FoodStore = foodStore, room: Room | null = townSession.getState().room): boolean {
  if (!open(room)) return false;
  store.setState({ seatRefused: null });
  const message: SeatSitMessage = { seatId };
  room.send(ClientMessage.SeatSit, message);
  return true;
}

/** `seat:stand`. The avatar stands at once (walking off stands the player up on the server too). */
export function sendStand(store: FoodStore = foodStore, room: Room | null = townSession.getState().room): boolean {
  if (store.getState().seat === null) return false;
  store.setState({ seat: null });
  if (!open(room)) return false;
  room.send(ClientMessage.SeatStand, {});
  return true;
}
