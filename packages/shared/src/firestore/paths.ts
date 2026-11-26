/**
 * Firestore document paths (GDD §9.4, architecture §8.1). Every read and write in the client and
 * the server builds its path here, so the paths match `firestore.rules`.
 */

/** Collection and fixed document ids. */
export const Collection = {
  Users: "users",
  Langs: "langs",
  Notebook: "notebook",
  NpcMemory: "npcMemory",
  Inventory: "inventory",
  Apartment: "apartment",
  Village: "village",
  Events: "events",
  Cache: "cache",
  Reports: "reports",
  Safety: "safety",
  Collections: "collections",
} as const;

/** `users/{uid}/collections/fish`: the fish encyclopedia (server-only, build plan M27). */
export const FISH_LOG_DOC = "fish";
/** `users/{uid}/collections/forage`: the forage album beside it (server-only, build plan M28). */
export const FORAGE_ALBUM_DOC = "forage";

/** `users/{uid}/safety/blocks`: the player's block list (server-only, build plan M18). */
export const BLOCK_LIST_DOC = "blocks";

/** `users/{uid}/apartment/layout` is the only document in the apartment collection. */
export const APARTMENT_LAYOUT_DOC = "layout";

/** The shared cache kinds under `cache/{kind}/…` (written only by the admin seeding tool). */
export const CACHE_KINDS = ["lines", "tts", "labels"] as const;
export type CacheKind = (typeof CACHE_KINDS)[number];

/**
 * A single Firestore path segment: non-empty, no `/`, not `.` or `..`, and not the reserved
 * `__name__` form. Firestore's own limit is 1500 bytes; ids here are far shorter.
 */
const SEGMENT = /^(?!\.\.?$)(?!__.*__$)[^/]{1,256}$/;

export function isValidPathSegment(segment: string): boolean {
  return SEGMENT.test(segment);
}

function join(...segments: string[]): string {
  for (const s of segments) {
    if (!isValidPathSegment(s)) throw new Error(`invalid Firestore path segment: ${JSON.stringify(s)}`);
  }
  return segments.join("/");
}

const C = Collection;

/** Builders for every document path in the data model. They throw on an invalid segment. */
export const FirestorePaths = {
  user: (uid: string) => join(C.Users, uid),
  lang: (uid: string, lang: string) => join(C.Users, uid, C.Langs, lang),
  notebook: (uid: string, lang: string) => join(C.Users, uid, C.Langs, lang, C.Notebook),
  notebookEntry: (uid: string, lang: string, entryId: string) =>
    join(C.Users, uid, C.Langs, lang, C.Notebook, entryId),
  npcMemory: (uid: string, lang: string, npcId: string) => join(C.Users, uid, C.Langs, lang, C.NpcMemory, npcId),
  inventorySlot: (uid: string, slot: string) => join(C.Users, uid, C.Inventory, slot),
  apartmentLayout: (uid: string) => join(C.Users, uid, C.Apartment, APARTMENT_LAYOUT_DOC),
  villageEvent: (shardId: string, eventId: string) => join(C.Village, shardId, C.Events, eventId),
  cacheEntry: (kind: CacheKind, id: string) => join(C.Cache, kind, id),
  report: (id: string) => join(C.Reports, id),
  reports: () => C.Reports,
  blockList: (uid: string) => join(C.Users, uid, C.Safety, BLOCK_LIST_DOC),
  fishLog: (uid: string) => join(C.Users, uid, C.Collections, FISH_LOG_DOC),
  forageAlbum: (uid: string) => join(C.Users, uid, C.Collections, FORAGE_ALBUM_DOC),
} as const;
