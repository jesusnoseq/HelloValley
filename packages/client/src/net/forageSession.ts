import { Callbacks, type Room } from "@colyseus/sdk";
// Values from shared that carry no zod (protocol/messages), so the entry chunk stays small.
import { ClientMessage, type ForageAlbumMessage, type ForagePickMessage, type ForageResultMessage, ServerMessage, type TownForageView } from "@hellovalley/shared";
import { type ForageStore, forageStore, initialForageState } from "../state/forageStore";
import { townSession } from "./townSession";

/**
 * The client side of foraging (build plan M28) over the TownRoom: the synced `forage` map (the
 * shard's spawns today) is mirrored into `forageStore`, `forage:result` and `forage:album` replace
 * the last answer and the album, and `sendPick` asks the server for the spawn the player stands
 * next to. The server checks the range from its own walker and decides what lands in the bag.
 */

/** Mirrors the room's forage state and messages into the store until the returned function is called. */
export function attachForage(room: Room, store: ForageStore = forageStore): () => void {
  store.setState({ ...initialForageState(), albumOpen: store.getState().albumOpen });
  const put = (spawnId: string, v: TownForageView) =>
    store.setState((s) => ({ spawns: { ...s.spawns, [spawnId]: { spawnId, itemId: v.itemId, kind: v.kind, x: v.x, z: v.z, pos: [v.x, v.z] } } }));
  const offs: (() => void)[] = [
    room.onMessage(ServerMessage.ForageResult, (msg: ForageResultMessage) => {
      store.setState((s) => ({ last: msg, picking: s.picking === msg.spawnId ? null : s.picking }));
    }),
    room.onMessage(ServerMessage.ForageAlbum, (msg: ForageAlbumMessage) => {
      store.setState({ album: msg.album, albumLoaded: true });
    }),
  ];
  const callbacks = Callbacks.get(room);
  offs.push(
    callbacks.onAdd("forage", (value: unknown, key: unknown) => put(String(key), value as TownForageView)),
    callbacks.onRemove("forage", (_value: unknown, key: unknown) => {
      const spawnId = String(key);
      store.setState((s) => {
        if (!(spawnId in s.spawns)) return s;
        const spawns = { ...s.spawns };
        delete spawns[spawnId];
        return { spawns, nearby: s.nearby === spawnId ? null : s.nearby };
      });
    }),
  );
  return () => {
    for (const off of offs) off();
    store.setState({ ...initialForageState(), albumOpen: store.getState().albumOpen });
  };
}

/** Sends `forage:pick` for a spawn. False without an open room or while another pick-up is on its way. */
export function sendPick(spawnId: string, store: ForageStore = forageStore, room: Room | null = townSession.getState().room): boolean {
  if (!room?.connection.isOpen || store.getState().picking !== null) return false;
  store.setState({ picking: spawnId, last: null });
  const message: ForagePickMessage = { spawnId };
  room.send(ClientMessage.ForagePick, message);
  return true;
}
