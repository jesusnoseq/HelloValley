import type { Room } from "@colyseus/sdk";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Values from shared that carry no zod (protocol/messages), so the entry chunk stays small.
import {
  ClientMessage,
  type IntercomEntry,
  type IntercomListMessage,
  ServerMessage,
  type VisitAnswerMessage,
  type VisitClosedMessage,
  type VisitIncomingMessage,
  type VisitRequestMessage,
  type VisitStatusMessage,
} from "@hellovalley/shared";
import { apartmentSession } from "./apartmentSession";

/**
 * The lobby intercom and visits (build plan M17, GDD §4.2), over the TownRoom: the intercom
 * panel's list of players online, the visitor's own request and its answer, and the requests
 * ringing at the local player's apartment. An accepted visit names the host whose ApartmentRoom
 * to join next (`apartmentSession.visitHost`); the server walks the visitor in with a teleport.
 */

export interface VisitSessionState {
  /** The intercom panel is open. */
  intercomOpen: boolean;
  /** The players the intercom listed, or null while the list is loading. */
  players: readonly IntercomEntry[] | null;
  /** The local player's latest request and where it stands. */
  outgoing: VisitStatusMessage | null;
  /** Requests ringing at the local player's apartment, oldest first. */
  incoming: readonly VisitIncomingMessage[];
}

export const visitSession = createStore<VisitSessionState>()(() => ({ intercomOpen: false, players: null, outgoing: null, incoming: [] }));

export function useVisitSession<T>(selector: (state: VisitSessionState) => T): T {
  return useStore(visitSession, selector);
}

let townRoom: Room | null = null;

const send = (type: ClientMessage, payload: unknown) => {
  if (townRoom?.connection.isOpen) townRoom.send(type, payload);
};

/** Opens the intercom panel and asks the room who is online. */
export function openIntercom(): void {
  visitSession.setState({ intercomOpen: true, players: null });
  send(ClientMessage.IntercomList, {});
}

export function closeIntercom(): void {
  visitSession.setState({ intercomOpen: false });
}

/** Rings a player's apartment. */
export function ringApartment(sessionId: string): void {
  const request: VisitRequestMessage = { sessionId };
  send(ClientMessage.VisitRequest, request);
}

/** The owner's answer to a request ringing at their apartment. */
export function answerVisit(requestId: string, accept: boolean): void {
  const answer: VisitAnswerMessage = { requestId, accept };
  send(ClientMessage.VisitAnswer, answer);
  visitSession.setState((s) => ({ incoming: s.incoming.filter((r) => r.requestId !== requestId) }));
}

/** Most requests kept on screen at once. */
const MAX_INCOMING = 4;

/** Listens for the intercom and visit messages of a TownRoom until the returned function runs. */
export function attachVisitMessages(room: Room): () => void {
  townRoom = room;
  visitSession.setState({ intercomOpen: false, players: null, outgoing: null, incoming: [] });
  // A fresh town session starts at home: no visit carries over.
  apartmentSession.setState({ visitHost: null });
  const offs = [
    room.onMessage(ServerMessage.IntercomList, ({ players }: IntercomListMessage) => visitSession.setState({ players })),
    room.onMessage(ServerMessage.VisitIncoming, (request: VisitIncomingMessage) =>
      visitSession.setState((s) => ({ incoming: [...s.incoming, request].slice(-MAX_INCOMING) })),
    ),
    room.onMessage(ServerMessage.VisitClosed, ({ requestId }: VisitClosedMessage) =>
      visitSession.setState((s) => ({ incoming: s.incoming.filter((r) => r.requestId !== requestId) })),
    ),
    room.onMessage(ServerMessage.VisitStatus, (status: VisitStatusMessage) => {
      // Arrives before the teleport, so the apartment connection joins the host's room.
      if (status.state === "accepted" && status.host) apartmentSession.setState({ visitHost: status.host });
      visitSession.setState({ outgoing: status, ...(status.state === "accepted" ? { intercomOpen: false } : {}) });
    }),
  ];
  return () => {
    for (const off of offs) off();
    if (townRoom === room) {
      townRoom = null;
      visitSession.setState({ intercomOpen: false, players: null, outgoing: null, incoming: [] });
    }
  };
}
