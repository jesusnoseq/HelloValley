import type { Room } from "@colyseus/sdk";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
// Values from shared that carry no zod (protocol/messages), so the entry chunk stays small.
import { type AmbientBark, ClientMessage, type NpcBarkMessage, type NpcId, ServerMessage, type VillagePrivacyMessage } from "@hellovalley/shared";
import { loadAmbientBark } from "../ai/client";
import type { BarkLine } from "../ai/barks";
import { avatarStore } from "../state/avatarStore";

/**
 * Ambient barks and the village news setting on the client (build plan M31). The TownRoom sends
 * `npc:bark` (who says what line index) to the players near the villagers; this module looks the
 * words up in the player's own target language (ai/ambient.ts: seeded lines, else the player's own
 * generation) and shows them as speech bubbles above the villagers for a few seconds; the second
 * line of an exchange follows the first. It also mirrors `village:privacy` (may the Gossip and the
 * Elder name the player in village news?) and sends changes.
 */

/** A bubble stays up this long (ms). */
export const BARK_SHOW_MS = 5000;
/** The second line of an exchange comes this much later (ms). */
export const EXCHANGE_REPLY_MS = 2200;

export interface BarkBubble {
  id: string;
  line: BarkLine;
  until: number;
}

export interface NpcBarkState {
  bubbles: Partial<Record<NpcId, BarkBubble>>;
  /** Whether village news may use the player's name (null until the room says). */
  named: boolean | null;
}

export type NpcBarkStore = ReturnType<typeof createNpcBarkStore>;

export function createNpcBarkStore() {
  return createStore<NpcBarkState>()(() => ({ bubbles: {}, named: null }));
}

export const npcBarkStore = createNpcBarkStore();

export function useNpcBarks<T>(selector: (s: NpcBarkState) => T): T {
  return useStore(npcBarkStore, selector);
}

export type BarkWords = (input: { bark: AmbientBark; targetLang: string; nativeLang: string }) => Promise<BarkLine[] | null>;

const speakers = (bark: AmbientBark): NpcId[] => (bark.kind === "solo" ? [bark.npcId] : [bark.a, bark.b]);

/** Mirrors the room's barks and the privacy setting until the returned function is called. */
export function attachNpcBarks(room: Room, store: NpcBarkStore = npcBarkStore, words: BarkWords = loadAmbientBark): () => void {
  store.setState({ bubbles: {}, named: null });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let detached = false;
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!detached) fn();
    }, ms);
    timers.add(t);
  };
  const show = (npcId: NpcId, id: string, line: BarkLine) => {
    store.setState((s) => ({ bubbles: { ...s.bubbles, [npcId]: { id, line, until: Date.now() + BARK_SHOW_MS } } }));
    later(BARK_SHOW_MS, () =>
      store.setState((s) => {
        if (s.bubbles[npcId]?.id !== id) return s;
        const bubbles = { ...s.bubbles };
        delete bubbles[npcId];
        return { bubbles };
      }),
    );
  };
  const offs = [
    room.onMessage(ServerMessage.NpcBark, (msg: NpcBarkMessage) => {
      const profile = avatarStore.getState().profile;
      if (!profile) return;
      const { id, ...bark } = msg;
      void words({ bark, targetLang: profile.targetLangs[0]!, nativeLang: profile.nativeLang }).then((lines) => {
        if (detached || !lines) return;
        speakers(bark).forEach((npcId, k) => {
          const line = lines[k];
          if (!line) return;
          if (k === 0) show(npcId, `${id}:${k}`, line);
          else later(EXCHANGE_REPLY_MS * k, () => show(npcId, `${id}:${k}`, line));
        });
      });
    }),
    room.onMessage(ServerMessage.VillagePrivacy, (msg: VillagePrivacyMessage) => store.setState({ named: msg.named })),
  ];
  return () => {
    detached = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const off of offs) off();
    store.setState({ bubbles: {}, named: null });
  };
}

/** Asks the server to name (or not name) the player in village news. */
export function sendVillagePrivacy(room: Room | null, named: boolean): void {
  if (!room?.connection.isOpen) return;
  const msg: VillagePrivacyMessage = { named };
  room.send(ClientMessage.VillagePrivacy, msg);
}
