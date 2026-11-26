import { Callbacks, type Room } from "@colyseus/sdk";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Values from shared that carry no zod (protocol/messages, world/clock), so the entry chunk stays small.
import {
  ClientMessage,
  ClockSync,
  type Emote,
  type EmoteBroadcast,
  type MoveCorrectionMessage,
  ServerMessage,
  type SpaceId,
  type TimeSyncReply,
  type TimeSyncRequest,
  type TownPlayerView,
  type TownWorldView,
  type Weather,
  type WelcomeMessage,
  type WireSpacePoint,
} from "@hellovalley/shared";
import { RemoteTrack, type RemoteSample } from "./interpolation";
import { chat } from "./chatSession";
import { attachFishing } from "./fishingSession";
import { attachForage } from "./forageSession";
import { attachInventory } from "./inventorySession";
import { attachVisitMessages } from "./visitSession";

/**
 * The client's mirror of its TownRoom (build plan M16; architecture §4: game state on the client
 * mirrors the room). React re-renders only for what changes rarely (who is here, their names,
 * looks and spaces: `townSession`); per-frame data (interpolation tracks, the synced clock,
 * corrections and emotes waiting for the scene) lives in `townLive`, read with plain property
 * access from the render loop.
 */

export interface RemotePlayerInfo {
  sessionId: string;
  name: string;
  /** Profile `{animal, colors}` as JSON (parse with AvatarAppearanceSchema). */
  appearance: string;
  space: SpaceId;
  /** The NPC they are talking to, or "" (build plan M23: the "chatting" indicator). */
  talkingTo: string;
  /** "" or "fishing" / "reeling" (build plan M27): the fishing clips. */
  activity: string;
}

export interface TownSessionState {
  room: Room | null;
  /** Shard number ("Valley #n") from the welcome. */
  shard: number | null;
  remotes: Readonly<Record<string, RemotePlayerInfo>>;
}

export const townSession = createStore<TownSessionState>()(() => ({ room: null, shard: null, remotes: {} }));

export function useTownSession<T>(selector: (state: TownSessionState) => T): T {
  return useStore(townSession, selector);
}

const WEATHERS: readonly string[] = ["sun", "rain", "fog"];

/** Per-frame data for the scene. */
export const townLive = {
  /** Interpolation buffers of the other players, by session id. */
  tracks: new Map<string, RemoteTrack>(),
  /** The server's wall clock, estimated from `time:sync` round trips. */
  clock: new ClockSync(),
  /** Corrections from the server, oldest first, for the local Player to apply. */
  corrections: [] as MoveCorrectionMessage[],
  /** The welcome's spawn point, until the local Player applies it (a fresh session). */
  spawn: null as WireSpacePoint | null,
  /**
   * The current room's welcome has arrived. The Player reports only after it: reports sent
   * earlier could be corrected into an epoch that the welcome's reset would then forget.
   */
  welcomed: false,
  /** Emotes other players played, by session id, until their avatars play them. */
  emotes: new Map<string, Emote[]>(),

  /** The estimated server wall time (ms), or null while there is no synced room. */
  serverNow(): number | null {
    return townSession.getState().room && this.clock.synced ? this.clock.serverTime(Date.now()) : null;
  },

  /** The weather the room broadcasts, or null offline. */
  serverWeather(): Weather | null {
    const world = (townSession.getState().room?.state as { world?: TownWorldView } | undefined)?.world;
    return world && WEATHERS.includes(world.weather) ? world.weather : null;
  },

  takeEmotes(sessionId: string): Emote[] {
    const list = this.emotes.get(sessionId);
    if (!list?.length) return [];
    this.emotes.delete(sessionId);
    return list;
  },
};

/** Clock probes: a few quick ones after joining, then a slow refresh. */
const QUICK_SYNC_MS = 400;
const QUICK_SYNCS = 4;
const SLOW_SYNC_MS = 15_000;

function sampleOf(p: TownPlayerView): RemoteSample {
  return { space: p.space, x: p.x, z: p.z, heading: p.heading, motion: p.motion };
}

/**
 * Mirrors `room` into the stores until the returned function is called (or the room is left):
 * other players' info and interpolation tracks, the welcome, corrections, emotes and the clock
 * sync, plus the chat (net/chatSession.ts), the inventory (net/inventorySession.ts), fishing (net/fishingSession.ts) and foraging (net/forageSession.ts). `onWelcome` gets the welcome message (uid and shard
 * for the HUD).
 */
export function attachTownRoom(room: Room, onWelcome?: (welcome: WelcomeMessage) => void): () => void {
  townLive.tracks.clear();
  townLive.emotes.clear();
  townLive.corrections = [];
  townLive.spawn = null;
  townLive.welcomed = false;
  townSession.setState({ room, shard: null, remotes: {} });

  const offs: (() => void)[] = [attachVisitMessages(room), chat.attach(room), attachInventory(room), attachFishing(room), attachForage(room)];
  offs.push(
    room.onMessage(ServerMessage.Welcome, (welcome: WelcomeMessage) => {
      townLive.spawn = welcome.spawn;
      townLive.welcomed = true;
      townSession.setState({ shard: welcome.shard });
      onWelcome?.(welcome);
    }),
    room.onMessage(ServerMessage.MoveCorrection, (c: MoveCorrectionMessage) => {
      townLive.corrections.push(c);
    }),
    room.onMessage(ServerMessage.Emote, ({ sessionId, emote }: EmoteBroadcast) => {
      const list = townLive.emotes.get(sessionId) ?? [];
      // Only the newest couple matter if a tab was in the background.
      list.push(emote);
      townLive.emotes.set(sessionId, list.slice(-2));
    }),
    room.onMessage(ServerMessage.TimeSync, (reply: TimeSyncReply) => {
      townLive.clock.add({ sentMs: reply.t, serverMs: reply.server, receivedMs: Date.now() });
    }),
  );

  const setRemote = (sessionId: string, p: TownPlayerView) => {
    const prev = townSession.getState().remotes[sessionId];
    const talkingTo = p.talkingTo ?? "";
    const activity = p.activity ?? "";
    if (prev && prev.name === p.name && prev.appearance === p.appearance && prev.space === p.space && prev.talkingTo === talkingTo && prev.activity === activity) return;
    townSession.setState((s) => ({
      remotes: { ...s.remotes, [sessionId]: { sessionId, name: p.name, appearance: p.appearance, space: p.space, talkingTo, activity } },
    }));
  };

  const callbacks = Callbacks.get(room);
  offs.push(
    callbacks.onAdd("players", (value: unknown, key: unknown) => {
      const player = value as TownPlayerView;
      const sessionId = String(key);
      if (sessionId === room.sessionId) return;
      const track = new RemoteTrack();
      track.push(performance.now(), sampleOf(player));
      townLive.tracks.set(sessionId, track);
      setRemote(sessionId, player);
      offs.push(
        callbacks.onChange(player as object, () => {
          townLive.tracks.get(sessionId)?.push(performance.now(), sampleOf(player));
          setRemote(sessionId, player);
        }),
      );
    }),
    callbacks.onRemove("players", (_value: unknown, key: unknown) => {
      const sessionId = String(key);
      townLive.tracks.delete(sessionId);
      townLive.emotes.delete(sessionId);
      townSession.setState((s) => {
        if (!(sessionId in s.remotes)) return s;
        const remotes = { ...s.remotes };
        delete remotes[sessionId];
        return { remotes };
      });
    }),
  );

  const probe = () => {
    if (!room.connection.isOpen) return;
    const request: TimeSyncRequest = { t: Date.now() };
    room.send(ClientMessage.TimeSync, request);
  };
  let quick = 0;
  probe();
  const quickTimer = setInterval(() => {
    probe();
    if (++quick >= QUICK_SYNCS) clearInterval(quickTimer);
  }, QUICK_SYNC_MS);
  const slowTimer = setInterval(probe, SLOW_SYNC_MS);

  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    clearInterval(quickTimer);
    clearInterval(slowTimer);
    for (const off of offs) off();
    if (townSession.getState().room === room) {
      townLive.tracks.clear();
      townLive.emotes.clear();
      townLive.corrections = [];
      townLive.spawn = null;
      townLive.welcomed = false;
      townSession.setState({ room: null, shard: null, remotes: {} });
    }
  };
  room.onLeave(detach);
  return detach;
}
