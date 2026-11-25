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
} as const;

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
} as const;
