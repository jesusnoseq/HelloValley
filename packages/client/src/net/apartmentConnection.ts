import { Client, type Room } from "@colyseus/sdk";
import type { User } from "firebase/auth";
import { useEffect } from "react";
import { worldStore } from "../state/worldStore";
import { apartmentSession, attachApartmentRoom, joinApartment } from "./apartmentSession";
import { SERVER_URL } from "./serverUrl";
import { townSession } from "./townSession";

/** Wait before retrying a failed apartment join. */
const RETRY_DELAY_MS = 2000;

/**
 * Which apartment the local player should be connected to: none outside the apartment space,
 * else the host of an accepted visit, else their own.
 */
export function wantedApartment(space: string, uid: string | null, visitHost: string | null, townOnline: boolean): string | null {
  if (space !== "apartment" || !uid || !townOnline) return null;
  return visitHost ?? uid;
}

/**
 * Keeps the player connected to the right ApartmentRoom (build plan M17): while they are in the
 * apartment space (their own, or a host's after an accepted visit) and the town session is up.
 * Leaving the apartment leaves the room and ends the visit. `uid` is the verified uid from the
 * town welcome (null until it arrives).
 */
export function useApartmentConnection(user: User, uid: string | null): void {
  useEffect(() => {
    let disposed = false;
    let current: { owner: string; room: Room | null; detach: (() => void) | null } | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const client = new Client(SERVER_URL);

    const leave = () => {
      const c = current;
      current = null;
      clearTimeout(retry);
      c?.detach?.();
      if (c?.room?.connection.isOpen) void c.room.leave();
    };

    const connect = async (owner: string) => {
      const entry = { owner, room: null as Room | null, detach: null as (() => void) | null };
      current = entry;
      try {
        const room = await joinApartment(client, await user.getIdToken(), owner);
        if (disposed || current !== entry) {
          void room.leave();
          return;
        }
        entry.room = room;
        entry.detach = attachApartmentRoom(room, owner, owner === uid);
        room.onLeave(() => {
          if (current !== entry) return;
          // The visit ended (or the server restarted): try again only while still wanted.
          current = null;
          retry = setTimeout(sync, RETRY_DELAY_MS);
        });
      } catch (err) {
        console.warn(`[apartment] could not join ${owner === uid ? "your" : "the host's"} apartment:`, err);
        if (current === entry) {
          current = null;
          retry = setTimeout(sync, RETRY_DELAY_MS);
        }
      }
    };

    const sync = () => {
      if (disposed) return;
      const space = worldStore.getState().space;
      const want = wantedApartment(space, uid, apartmentSession.getState().visitHost, townSession.getState().room !== null);
      if (want === (current?.owner ?? null)) return;
      leave();
      if (want) void connect(want);
    };

    const unsubs = [
      worldStore.subscribe((s, prev) => {
        if (s.space === prev.space) return;
        // Walking out of the apartment ends a visit: the next apartment is your own again.
        if (prev.space === "apartment" && apartmentSession.getState().visitHost) apartmentSession.setState({ visitHost: null });
        sync();
      }),
      apartmentSession.subscribe((s, prev) => {
        if (s.visitHost !== prev.visitHost) sync();
      }),
      townSession.subscribe((s, prev) => {
        if (s.room !== prev.room) sync();
      }),
    ];
    sync();
    return () => {
      disposed = true;
      for (const u of unsubs) u();
      leave();
    };
  }, [user, uid]);
}
