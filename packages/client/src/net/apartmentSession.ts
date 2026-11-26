import { Callbacks, type Client, type Room } from "@colyseus/sdk";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Values from shared that carry no zod (protocol/messages), so the entry chunk stays small.
import {
  type ApartmentJoinOptions,
  type ApartmentOccupantView,
  type ApartmentStateView,
  ClientMessage,
  type FurnitureEdit,
  type FurnitureEditMessage,
  type FurnitureResultMessage,
  RoomName,
  ServerMessage,
} from "@hellovalley/shared";

/**
 * The client's mirror of the ApartmentRoom it is in (build plan M17): whose apartment, its
 * furniture layout (raw JSON; scene/apartmentLayout.ts parses it), the people inside (their
 * TownRoom session ids, so RemotePlayers can show them from the TownRoom state) and the answers
 * to the owner's furniture edits. Offline (the dev page) there is no room: edits go to a local
 * handler instead, so placement mode can be tried without a server.
 */

export interface ApartmentSessionState {
  room: Room | null;
  /** Owner uid of the apartment the room mirrors, or null. */
  owner: string | null;
  /** The local player owns it (placement mode is theirs). */
  isOwner: boolean;
  ownerName: string;
  apartmentId: string;
  /** `ApartmentLayoutData` as JSON from the room, or null before it arrives (or offline). */
  layoutJson: string | null;
  revision: number;
  /** TownRoom session ids of everyone in the apartment. */
  occupants: readonly string[];
  /** The host of an accepted visit: the next apartment room to join is theirs, not ours. */
  visitHost: string | null;
  /** The answer to the latest furniture edit. */
  lastResult: FurnitureResultMessage | null;
}

const EMPTY = {
  room: null,
  owner: null,
  isOwner: false,
  ownerName: "",
  apartmentId: "",
  layoutJson: null,
  revision: 0,
  occupants: [],
  lastResult: null,
} as const satisfies Omit<ApartmentSessionState, "visitHost">;

export const apartmentSession = createStore<ApartmentSessionState>()(() => ({ ...EMPTY, visitHost: null }));

export function useApartmentSession<T>(selector: (state: ApartmentSessionState) => T): T {
  return useStore(apartmentSession, selector);
}

/** Where edits go when there is no room (the dev page applies them locally). */
let offlineEditor: ((edit: FurnitureEdit) => FurnitureResultMessage) | null = null;

export function setOfflineFurnitureEditor(editor: typeof offlineEditor): void {
  offlineEditor = editor;
}

let editIds = 0;

/** Sends one placement-mode edit to the owner's ApartmentRoom (or the offline editor). */
export function sendFurnitureEdit(edit: FurnitureEdit): void {
  const room = apartmentSession.getState().room;
  const editId = ++editIds;
  if (room?.connection.isOpen) {
    const message: FurnitureEditMessage = { ...edit, editId };
    room.send(ClientMessage.FurnitureEdit, message);
  } else if (offlineEditor) {
    apartmentSession.setState({ lastResult: { ...offlineEditor(edit), editId } });
  }
}

/** Mirrors `room` into the store until the returned function runs (or the room is left). */
export function attachApartmentRoom(room: Room, owner: string, isOwner: boolean): () => void {
  apartmentSession.setState({ ...EMPTY, room, owner, isOwner });
  const state = room.state as ApartmentStateView & { occupants?: Map<string, ApartmentOccupantView> };
  const read = () => {
    if (apartmentSession.getState().room !== room) return;
    const occupants = state.occupants ? [...state.occupants.values()].map((o) => o.townSession).filter(Boolean) : [];
    apartmentSession.setState({
      ownerName: state.ownerName ?? "",
      apartmentId: state.apartmentId ?? "",
      layoutJson: state.layout || null,
      revision: state.revision ?? 0,
      occupants,
    });
  };
  const callbacks = Callbacks.get(room);
  const offs: (() => void)[] = [
    room.onMessage(ServerMessage.FurnitureResult, (result: FurnitureResultMessage) => apartmentSession.setState({ lastResult: result })),
    callbacks.listen("layout", read),
    callbacks.listen("revision", read),
    callbacks.listen("ownerName", read),
    callbacks.onAdd("occupants", read),
    // The removed occupant may still be in the map while the callback runs.
    callbacks.onRemove("occupants", () => queueMicrotask(read)),
  ];
  read();
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    for (const off of offs) off();
    if (apartmentSession.getState().room === room) apartmentSession.setState({ ...EMPTY });
  };
  room.onLeave(detach);
  return detach;
}

/** Joins `owner`'s ApartmentRoom (one per owner on the server, `filterBy(["owner"])`). */
export async function joinApartment(client: Client, idToken: string, owner: string, appCheckToken: string | null = null): Promise<Room> {
  const options: ApartmentJoinOptions = { idToken, owner, ...(appCheckToken ? { appCheckToken } : {}) };
  return client.joinOrCreate(RoomName.Apartment, options);
}
