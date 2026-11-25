import { Client, type Room } from "@colyseus/sdk";
import { type JoinOptions, RoomName, ServerMessage, type WelcomeMessage } from "@hellovalley/shared";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ConnectionState {
  status: ConnectionStatus;
  /** Last measured round trip in milliseconds, or null before the first ping. */
  pingMs: number | null;
  /** The uid the server verified from the ID token (`session:welcome`), or null before it arrives. */
  uid: string | null;
  error: string | null;
}

/** Game server base URL. Local dev talks to the server started by `npm run dev`. */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? "http://127.0.0.1:2567";

const PING_INTERVAL_MS = 2000;
const RETRY_DELAY_MS = 2000;

/**
 * Joins the town room as `user` and keeps it alive for the component's lifetime: pings every 2 s
 * and retries the join when it fails or the room is lost (the server may still be starting when
 * Vite serves the page, and restarts drop every connection, architecture §3.1). Every join sends
 * a current Firebase ID token, which the server verifies in TownRoom.onAuth.
 * TODO(M16): move the room into a store so the scene can mirror its state.
 */
export function useTownConnection(user: User): ConnectionState {
  const [state, setState] = useState<ConnectionState>({ status: "connecting", pingMs: null, uid: null, error: null });

  useEffect(() => {
    let disposed = false;
    let room: Room | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const client = new Client(SERVER_URL);
    const update = (patch: Partial<ConnectionState>) => {
      if (!disposed) setState((s) => ({ ...s, ...patch }));
    };

    const connect = async () => {
      update({ status: "connecting" });
      try {
        // getIdToken() refreshes the token when it is about to expire.
        const options: JoinOptions = { idToken: await user.getIdToken() };
        const joined = await client.joinOrCreate(RoomName.Town, options);
        if (disposed) {
          void joined.leave();
          return;
        }
        room = joined;
        update({ status: "connected", error: null });
        joined.onMessage(ServerMessage.Welcome, (msg: WelcomeMessage) => update({ uid: msg.uid }));
        const ping = () => joined.ping((ms) => update({ pingMs: Math.round(ms) }));
        ping();
        pingTimer = setInterval(ping, PING_INTERVAL_MS);
        joined.onDrop(() => update({ status: "reconnecting" }));
        joined.onReconnect(() => update({ status: "connected" }));
        joined.onError((code, message) => update({ error: `${code}${message ? `: ${message}` : ""}` }));
        joined.onLeave(() => {
          clearInterval(pingTimer);
          room = undefined;
          update({ status: "disconnected", pingMs: null, uid: null });
          // The SDK's own reconnection gave up (or the server closed the room): start a fresh join.
          if (!disposed) retryTimer = setTimeout(connect, RETRY_DELAY_MS);
        });
      } catch (err) {
        update({ status: "disconnected", error: err instanceof Error ? err.message : String(err) });
        if (!disposed) retryTimer = setTimeout(connect, RETRY_DELAY_MS);
      }
    };

    void connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      void room?.leave();
    };
  }, [user]);

  return state;
}
