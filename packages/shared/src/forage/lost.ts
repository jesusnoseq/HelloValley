import { getItem } from "../data/items";
import { LOST_ITEMS, type LostItemDef, type LostItemId, LOST_ITEM_IDS } from "../data/forage";
import { getNpc, type NpcId } from "../data/npcs";
import type { PlaceId } from "../data/world";
import { clampHearts, type NpcBond } from "../npc/friendship";
import type { ForageSpawn } from "./spawns";

/**
 * Lost NPC items (build plan M28, GDD §5.3): each in-game day a couple of villagers' belongings
 * lie somewhere in town (forage/spawns.ts). The Gossip hints at where (an NPC turn whose context
 * lists the lost items and the places they lie near), the player finds and picks one up, and
 * returning it to its owner in a conversation earns friendship. Pure rules; the game server's
 * store applies them in one transaction.
 *
 * Numbers are mine (see pending.md §M28): returning a lost item gives +1½ hearts, once per lost
 * item per in-game day (a second copy the same day is still taken back, for no hearts), so
 * shard-hopping for copies does not farm hearts.
 */

export const LOST_ITEM_RETURN_HEARTS = 1.5;

export function isLostItemId(id: string): id is LostItemId {
  return (LOST_ITEM_IDS as readonly string[]).includes(id);
}

export function getLostItem(id: string): LostItemDef | undefined {
  return LOST_ITEMS.find((l) => l.id === id);
}

export function lostItemOwner(id: string): NpcId | undefined {
  return getLostItem(id)?.owner;
}

export type LostReturnRefusal = "not_lost_item" | "not_owner";

export type LostReturnOutcome =
  | { ok: true; bond: NpcBond; delta: number; rewarded: boolean }
  | { ok: false; reason: LostReturnRefusal };

/**
 * The player hands a lost item back to `npcId` (the caller checks the player holds it and removes
 * it in the same transaction). Only the owner takes it; the first return of that item in an
 * in-game day (`lastReturnedDay` ≠ `today`) adds LOST_ITEM_RETURN_HEARTS.
 */
export function applyLostReturn(bond: NpcBond, npcId: NpcId, itemId: string, lastReturnedDay: number | null, today: number): LostReturnOutcome {
  if (!isLostItemId(itemId)) return { ok: false, reason: "not_lost_item" };
  if (lostItemOwner(itemId) !== npcId) return { ok: false, reason: "not_owner" };
  const before = clampHearts(bond.hearts);
  const rewarded = lastReturnedDay !== today;
  const hearts = rewarded ? clampHearts(before + LOST_ITEM_RETURN_HEARTS) : before;
  return { ok: true, bond: { ...bond, hearts }, delta: hearts - before, rewarded };
}

/** One lost item the Gossip can hint at: what it is, whose, and the place it lies near. */
export interface LostItemHint {
  itemId: LostItemId;
  owner: NpcId;
  place: PlaceId;
}

/** The Gossip's hints: the lost items still lying in the shard today (picked ones are gone). */
export function lostItemHints(open: Iterable<ForageSpawn>): LostItemHint[] {
  const out: LostItemHint[] = [];
  for (const s of open) {
    if (s.kind !== "lost" || !s.place || !isLostItemId(s.itemId)) continue;
    out.push({ itemId: s.itemId, owner: lostItemOwner(s.itemId)!, place: s.place });
  }
  return out;
}

const lostName = (id: LostItemId) => getLostItem(id)!.englishName.toLowerCase();

/**
 * Context flags for an NPC turn (npc-runtime.md §1 "Extra context"): which lost items the player
 * carries. The owner learns the player has *their* item (and can be given it back); the others
 * only that the player carries someone's lost item.
 */
export function lostItemFlags(npcId: NpcId, inventory: readonly { itemId: string; qty: number }[]): string[] {
  const flags: string[] = [];
  for (const e of inventory) {
    if (e.qty <= 0 || !isLostItemId(e.itemId) || getItem(e.itemId)?.category !== "lost") continue;
    const owner = lostItemOwner(e.itemId)!;
    flags.push(
      owner === npcId
        ? `the player found your lost ${lostName(e.itemId)} and is carrying it (they can give it back to you)`
        : `the player is carrying the ${getNpc(owner).englishName}'s lost ${lostName(e.itemId)}`,
    );
  }
  return flags;
}
