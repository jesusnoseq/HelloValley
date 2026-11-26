import type { Room } from "@colyseus/sdk";
// Values from shared that carry no zod (protocol/messages, npc/inventory), so the entry chunk stays small.
import { ClientMessage, type InventoryMoveMessage, type InventoryStateMessage, isSlotIndex, moveSlot, ServerMessage } from "@hellovalley/shared";
import { initialInventoryState, type InventoryStore, inventoryStore } from "../state/inventoryStore";
import { townSession } from "./townSession";

/**
 * The client side of the inventory (build plan M26) over the TownRoom: `inventory:state` from the
 * server replaces the mirror in `inventoryStore` (after the join, every trade, gift and move), and
 * `moveInventory` sends `inventory:move`. The server is authoritative: a move shows at once as a
 * preview (shared `moveSlot`, the same rule the server runs) and the server's answer replaces it.
 */

let nextMoveId = 1;

/** Mirrors the room's `inventory:state` into the store until the returned function is called. */
export function attachInventory(room: Room, store: InventoryStore = inventoryStore): () => void {
  const { open } = store.getState();
  store.setState({ ...initialInventoryState(), open });
  const off = room.onMessage(ServerMessage.InventoryState, (state: InventoryStateMessage) => {
    const { selected, held } = store.getState();
    store.setState({
      status: "ready",
      lang: state.lang,
      coins: state.coins,
      slots: state.slots,
      refused: state.refused ?? null,
      // A picked-up stack that is gone (sold, given away) is no longer held.
      held: held !== null && state.slots.some((s) => s.slot === held) ? held : null,
      selected,
    });
  });
  return () => {
    off();
    store.setState({ ...initialInventoryState(), open: store.getState().open });
  };
}

/** Moves the stack in `from` onto `to` (bag or hotbar). False when there is no room or nothing to move. */
export function moveInventory(from: number, to: number, store: InventoryStore = inventoryStore, room: Room | null = townSession.getState().room): boolean {
  const state = store.getState();
  store.setState({ held: null });
  if (!room || state.status !== "ready" || !isSlotIndex(from) || !isSlotIndex(to) || from === to) return false;
  const preview = moveSlot(state.slots, from, to);
  if (!preview.ok) return false;
  store.setState({ slots: preview.slots, refused: null });
  const message: InventoryMoveMessage = { from, to, moveId: nextMoveId++ };
  room.send(ClientMessage.InventoryMove, message);
  return true;
}
