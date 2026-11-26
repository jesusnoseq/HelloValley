import type { Room } from "@colyseus/sdk";
// Values from shared that carry no zod (protocol/messages), so the entry chunk stays small.
import { ClientMessage, type QuestAcceptMessage, type QuestResultMessage, type QuestStateMessage, type QuestTurnInMessage, ServerMessage } from "@hellovalley/shared";
import { initialQuestState, type QuestStore, questStore } from "../state/questStore";
import { townSession } from "./townSession";

/**
 * The client side of daily requests (build plan M30) over the TownRoom: `quests:state` replaces
 * the board and the log, `quest:result` the last answer. `sendAccept` takes a request at the
 * notice board, `sendHandOver` hands a delivery or fetch to the NPC in the open conversation; the
 * server checks where the player stands, who they talk to, the bag and the deadline.
 */

/** Mirrors the room's quest messages into the store until the returned function is called. */
export function attachQuests(room: Room, store: QuestStore = questStore): () => void {
  const keep = () => ({ boardOpen: store.getState().boardOpen, logOpen: store.getState().logOpen });
  store.setState({ ...initialQuestState(), ...keep() });
  const offs = [
    room.onMessage(ServerMessage.QuestState, (msg: QuestStateMessage) => {
      store.setState({ day: msg.day, level: msg.level, board: msg.board, log: msg.log });
    }),
    room.onMessage(ServerMessage.QuestResult, (msg: QuestResultMessage) => {
      store.setState((s) => ({ last: msg, sending: s.sending === msg.questId ? null : s.sending }));
    }),
  ];
  return () => {
    for (const off of offs) off();
    store.setState({ ...initialQuestState(), ...keep() });
  };
}

/** Sends `quest:accept` (at the notice board). False without an open room or while another request is on its way. */
export function sendAccept(questId: string, store: QuestStore = questStore, room: Room | null = townSession.getState().room): boolean {
  if (!room?.connection.isOpen || store.getState().sending !== null) return false;
  store.setState({ sending: questId, last: null });
  const message: QuestAcceptMessage = { questId };
  room.send(ClientMessage.QuestAccept, message);
  return true;
}

/** Sends `quest:handover` for the open conversation. */
export function sendHandOver(conversationId: string, questId: string, store: QuestStore = questStore, room: Room | null = townSession.getState().room): boolean {
  if (!room?.connection.isOpen || store.getState().sending !== null) return false;
  store.setState({ sending: questId, last: null });
  const message: QuestTurnInMessage = { conversationId, questId };
  room.send(ClientMessage.QuestTurnIn, message);
  return true;
}
