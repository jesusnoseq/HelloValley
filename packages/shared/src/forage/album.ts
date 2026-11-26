import { FORAGE, FORAGE_KINDS, type ForageKind, LOST_ITEMS, type LostItemId } from "../data/forage";
import { isItemId } from "../data/items";
import { isLostItemId } from "./lost";
import type { CollectibleId } from "./spawns";

/**
 * The forage album (build plan M28, GDD §2 "Collections: foraged-item album"), the forage twin of
 * the fish encyclopedia (fishing/log.ts): which forage and lost items the player has found, how
 * many and when first and last, plus how often each lost item went back to its owner and on which
 * in-game day last (that day caps the friendship reward, forage/lost.ts). The server keeps it in
 * `users/{uid}/collections/forage` (Admin SDK only) and sends it with `forage:album`.
 */

export interface AlbumEntry {
  count: number;
  /** ms since the Unix epoch. */
  firstMs: number;
  lastMs: number;
}

export interface ReturnedEntry {
  count: number;
  /** In-game day of the last return. */
  lastDay: number;
}

export interface ForageAlbum {
  found: Partial<Record<CollectibleId, AlbumEntry>>;
  returned: Partial<Record<LostItemId, ReturnedEntry>>;
}

export const emptyAlbum = (): ForageAlbum => ({ found: {}, returned: {} });

export const COLLECTIBLE_IDS: readonly CollectibleId[] = [...FORAGE.map((f) => f.id), ...LOST_ITEMS.map((l) => l.id)];

export function isCollectibleId(id: string): id is CollectibleId {
  return (COLLECTIBLE_IDS as readonly string[]).includes(id);
}

/** Adds one find; `first` says whether it is new to the album. Returns a new album. */
export function recordFind(album: ForageAlbum, itemId: CollectibleId, nowMs: number): { album: ForageAlbum; first: boolean; entry: AlbumEntry } {
  const prev = album.found[itemId];
  const entry: AlbumEntry = prev ? { count: prev.count + 1, firstMs: prev.firstMs, lastMs: nowMs } : { count: 1, firstMs: nowMs, lastMs: nowMs };
  return { album: { ...album, found: { ...album.found, [itemId]: entry } }, first: !prev, entry };
}

/** Adds one return of a lost item on in-game day `today`. */
export function recordReturn(album: ForageAlbum, itemId: LostItemId, today: number): ForageAlbum {
  const prev = album.returned[itemId];
  return { ...album, returned: { ...album.returned, [itemId]: { count: (prev?.count ?? 0) + 1, lastDay: today } } };
}

export interface AlbumStats {
  /** Distinct forage items found, of FORAGE.length. */
  forage: { found: number; of: number };
  /** Distinct lost items found, of LOST_ITEMS.length. */
  lost: { found: number; of: number };
  /** Lost items handed back, in total. */
  returned: number;
  byKind: Record<ForageKind, { found: number; of: number }>;
}

export function albumStats(album: ForageAlbum): AlbumStats {
  const byKind = Object.fromEntries(FORAGE_KINDS.map((k) => [k, { found: 0, of: 0 }])) as AlbumStats["byKind"];
  let forage = 0;
  for (const f of FORAGE) {
    byKind[f.kind].of++;
    if ((album.found[f.id]?.count ?? 0) > 0) {
      forage++;
      byKind[f.kind].found++;
    }
  }
  const lost = LOST_ITEMS.filter((l) => (album.found[l.id]?.count ?? 0) > 0).length;
  const returned = Object.values(album.returned).reduce((sum, r) => sum + (r?.count ?? 0), 0);
  return { forage: { found: forage, of: FORAGE.length }, lost: { found: lost, of: LOST_ITEMS.length }, returned, byKind };
}

/** Keeps only known items with sane entries (a stored album is outside our control). */
export function cleanAlbum(raw: { found?: Readonly<Record<string, AlbumEntry>>; returned?: Readonly<Record<string, ReturnedEntry>> }): ForageAlbum {
  const out = emptyAlbum();
  for (const [id, e] of Object.entries(raw.found ?? {})) {
    if (isCollectibleId(id) && isItemId(id) && Number.isInteger(e.count) && e.count > 0) out.found[id] = { count: e.count, firstMs: e.firstMs, lastMs: e.lastMs };
  }
  for (const [id, e] of Object.entries(raw.returned ?? {})) {
    if (isLostItemId(id) && Number.isInteger(e.count) && e.count > 0 && Number.isInteger(e.lastDay)) out.returned[id] = { count: e.count, lastDay: e.lastDay };
  }
  return out;
}
