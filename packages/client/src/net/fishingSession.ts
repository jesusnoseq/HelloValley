import type { Room } from "@colyseus/sdk";
// Values from shared that carry no zod (protocol/messages), so the entry chunk stays small.
import {
  ClientMessage,
  type FishCastMessage,
  type FishCastResultMessage,
  type FishLogMessage,
  type FishReelMessage,
  type FishResultMessage,
  ServerMessage,
} from "@hellovalley/shared";
import { type FishingStore, fishingStore, initialFishingState } from "../state/fishingStore";
import { townSession } from "./townSession";

/**
 * The client side of fishing (build plan M27) over the TownRoom: the server's answers go into
 * `fishingStore`. `fish:cast` turns a cast the player started into the wait for a bite (the bite
 * time is counted from when the answer arrived); `fish:result` shows the catch card or ends the
 * cast; `fish:log` replaces the encyclopedia. The steering (charge, bite, reel) is the lazy
 * fishing layer's (ui/fishing).
 */

/** Mirrors the room's fishing messages into the store until the returned function is called. */
export function attachFishing(room: Room, store: FishingStore = fishingStore, now: () => number = () => performance.now()): () => void {
  store.setState({ ...initialFishingState(), bookOpen: store.getState().bookOpen });
  const offs = [
    room.onMessage(ServerMessage.FishCast, (msg: FishCastResultMessage) => {
      if (store.getState().phase !== "casting") return;
      if (msg.ok) store.setState({ phase: "waiting", cast: msg, biteAtMs: now() + msg.biteInMs, notice: null });
      else store.setState({ phase: "idle", cast: null, biteAtMs: null, notice: msg.reason });
    }),
    room.onMessage(ServerMessage.FishResult, (msg: FishResultMessage) => {
      const s = store.getState();
      if (s.cast?.castId !== msg.castId) return;
      if (msg.outcome === "caught") store.setState({ phase: "result", result: msg, reel: null, biteAtMs: null });
      else if (s.phase === "landing") store.setState({ phase: "idle", cast: null, reel: null, biteAtMs: null, notice: msg.outcome === "refused" ? msg.reason : (s.notice ?? "escaped") });
    }),
    room.onMessage(ServerMessage.FishLog, (msg: FishLogMessage) => {
      store.setState({ log: msg.species, logLoaded: true });
    }),
  ];
  return () => {
    for (const off of offs) off();
    store.setState({ ...initialFishingState(), bookOpen: store.getState().bookOpen });
  };
}

/** Sends `fish:cast`. False without an open room. */
export function sendCast(message: FishCastMessage, room: Room | null = townSession.getState().room): boolean {
  if (!room?.connection.isOpen) return false;
  room.send(ClientMessage.FishCast, message);
  return true;
}

/** Sends `fish:reel`. */
export function sendReel(message: FishReelMessage, room: Room | null = townSession.getState().room): void {
  if (room?.connection.isOpen) room.send(ClientMessage.FishReel, message);
}
