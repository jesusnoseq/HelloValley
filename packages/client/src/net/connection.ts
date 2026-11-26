import { Client, type Room } from "@colyseus/sdk";
import { type JoinOptions, RoomName, SESSION_REPLACED_CODE, type WelcomeMessage } from "@hellovalley/shared";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import { currentAppCheckToken } from "./appCheckToken";
import { SERVER_URL } from "./serverUrl";
import { attachTownRoom } from "./townSession";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "replaced";

export interface ConnectionState {
  status: ConnectionStatus;
  /** Last measured round trip in milliseconds, or null before the first ping. */
  pingMs: number | null;
  /** The uid the server verified from the ID token (`session:welcome`), or null before it arrives. */
  uid: string | null;
  /** The shard ("Valley #n") the session is in, or null. */
  shard: number | null;
  error: string | null;
}

export { SERVER_URL };

const PING_INTERVAL_MS = 2000;
const RETRY_DELAY_MS = 2000;

/** `?friend=<uid>` in the page URL: join that player's shard (build plan M16). TODO(M37): a shard picker in the UI. */
export function friendFromUrl(search: string = typeof location === "undefined" ? "" : location.search): string | null {
  const uid = new URLSearchParams(search).get("friend");
  return uid && /^[A-Za-z0-9_-]{1,128}$/.test(uid) ? uid : null;
}

/**
 * Joins a town shard: the friend's shard when `friendUid` is given and it has a free seat
 * (looked up with GET /api/shards, then joined by id), else normal matchmaking (the lowest shard
 * with a free seat, or a new one).
 */
export async function joinTown(client: Client, user: Pick<User, "getIdToken">, friendUid: string | null): Promise<Room> {
  // getIdToken() refreshes the token when it is about to expire.
  // Build plan M36: the App Check token too, when App Check is configured.
  const [idToken, appCheckToken] = await Promise.all([user.getIdToken(), currentAppCheckToken()]);
  const options: JoinOptions = { idToken, ...(appCheckToken ? { appCheckToken } : {}) };
  if (friendUid) {
    try {
      // The API client pulls in shared schemas (zod): load it only when needed.
      const { getShards } = await import("./api");
      const { friend } = await getShards(user, friendUid);
      if (friend) return await client.joinById(friend.roomId, options);
    } catch (err) {
      console.warn("[town] could not join the friend's shard, matchmaking instead:", err);
    }
  }
  return client.joinOrCreate(RoomName.Town, options);
}

/**
 * Joins the town room as `user` and keeps it alive for the component's lifetime: pings every 2 s
 * and retries the join when it fails or the room is lost (the server may still be starting when
 * Vite serves the page, and restarts drop every connection, architecture §3.1). Every join sends
 * a current Firebase ID token, which the server verifies in TownRoom.onAuth. The joined room is
 * mirrored into `townSession` for the scene (remote avatars, the clock, corrections). When the
 * same player opens another tab, the server closes this session and it does not rejoin.
 */
export function useTownConnection(user: User): ConnectionState {
  const [state, setState] = useState<ConnectionState>({ status: "connecting", pingMs: null, uid: null, shard: null, error: null });

  useEffect(() => {
    let disposed = false;
    let room: Room | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const client = new Client(SERVER_URL);
    const friend = friendFromUrl();
    const update = (patch: Partial<ConnectionState>) => {
      if (!disposed) setState((s) => ({ ...s, ...patch }));
    };

    const connect = async () => {
      update({ status: "connecting" });
      try {
        const joined = await joinTown(client, user, friend);
        if (disposed) {
          void joined.leave();
          return;
        }
        room = joined;
        attachTownRoom(joined, (msg: WelcomeMessage) => update({ uid: msg.uid, shard: msg.shard }));
        update({ status: "connected", error: null });
        const ping = () => joined.ping((ms) => update({ pingMs: Math.round(ms) }));
        ping();
        pingTimer = setInterval(ping, PING_INTERVAL_MS);
        joined.onDrop(() => update({ status: "reconnecting" }));
        joined.onReconnect(() => update({ status: "connected" }));
        joined.onError((code, message) => update({ error: `${code}${message ? `: ${message}` : ""}` }));
        joined.onLeave((code: number) => {
          clearInterval(pingTimer);
          room = undefined;
          if (code === SESSION_REPLACED_CODE) {
            // Another tab of this player took over: stay out, or the two tabs would keep kicking each other.
            update({ status: "replaced", pingMs: null, uid: null, shard: null });
            return;
          }
          update({ status: "disconnected", pingMs: null, uid: null, shard: null });
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
