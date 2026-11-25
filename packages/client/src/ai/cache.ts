/**
 * Per-player cache of generated content (architecture §8.3, CLAUDE.md): a memory LRU for the
 * session over the player's own IndexedDB (per uid, size-capped, oldest entries evicted first).
 * Keys are content hashes, `sha256(kind, npcId, lang, level, text)` (shared `contentKeyMaterial`).
 *
 * Play-time answers are never written to the shared Firestore `cache/*`: only the admin seeding
 * tool writes there (architecture §6.3), so one player cannot poison another's content. Openers
 * (`openers.ts`, build plan M21) are cached here too; reading seeded `cache/lines` is an injected
 * reader that waits for the admin seeding tool.
 *
 * Every IndexedDB access is wrapped: in private mode, or with storage blocked, the cache simply
 * works from memory.
 */

/** Hex SHA-256 of a string (Web Crypto, in the browser and in Node). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Lru<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  readonly size: number;
}

export function createLru<T>(maxEntries: number): Lru<T> {
  const map = new Map<string, T>();
  return {
    get size() {
      return map.size;
    },
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key) as T;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > maxEntries) map.delete(map.keys().next().value!);
    },
  };
}

/** A persistent key-value store; implementations never throw (a failure is a miss). */
export interface PersistentStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Entries kept in IndexedDB per player (my number: glosses and translations are small). */
export const IDB_CACHE_MAX_ENTRIES = 3000;
const STORE = "entries";

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("indexedDB request failed"));
  });

/**
 * The player's IndexedDB cache (`hv-ai-{uid}`). Entries carry their write time; past
 * `maxEntries` the oldest go first. Without IndexedDB it is a store that never hits.
 */
export function createIdbStore(uid: string, maxEntries: number = IDB_CACHE_MAX_ENTRIES, idb: IDBFactory | undefined = globalThis.indexedDB): PersistentStore {
  let db: Promise<IDBDatabase | null> | null = null;
  const open = () => {
    db ??= (async () => {
      if (!idb) return null;
      try {
        const r = idb.open(`hv-ai-${uid}`, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("at", "at");
        return await request(r);
      } catch {
        return null;
      }
    })();
    return db;
  };
  let writes = 0;
  const evict = async (d: IDBDatabase) => {
    const tx = d.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let extra = (await request(store.count())) - maxEntries;
    if (extra <= 0) return;
    const cursor = store.index("at").openCursor();
    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || extra <= 0) return resolve();
        c.delete();
        extra--;
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error ?? new Error("cursor failed"));
    });
  };
  return {
    async get(key) {
      try {
        const d = await open();
        if (!d) return undefined;
        const row = (await request(d.transaction(STORE, "readonly").objectStore(STORE).get(key))) as { value?: unknown } | undefined;
        return row?.value;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        const d = await open();
        if (!d) return;
        await request(d.transaction(STORE, "readwrite").objectStore(STORE).put({ key, value, at: Date.now() }));
        // Counting on every write is wasteful: check every 50 writes.
        if (++writes % 50 === 1) await evict(d);
      } catch {
        // A full or blocked store is just a cache miss next time.
      }
    },
  };
}

/** Memory entries per session (my number). */
export const MEMORY_CACHE_MAX_ENTRIES = 1000;

export interface ContentCache {
  /** Looks up memory, then (for `persist`) IndexedDB, which also refills memory. */
  get(material: string, persist: boolean): Promise<unknown>;
  set(material: string, value: unknown, persist: boolean): Promise<void>;
}

/** The two-level cache, keyed by the SHA-256 of the key material. */
export function createContentCache(persistent: PersistentStore | null, memoryMax: number = MEMORY_CACHE_MAX_ENTRIES): ContentCache {
  const memory = createLru<unknown>(memoryMax);
  return {
    async get(material, persist) {
      const key = await sha256Hex(material);
      const hit = memory.get(key);
      if (hit !== undefined || !persist || !persistent) return hit;
      const stored = await persistent.get(key);
      if (stored !== undefined) memory.set(key, stored);
      return stored;
    },
    async set(material, value, persist) {
      const key = await sha256Hex(material);
      memory.set(key, value);
      if (persist && persistent) await persistent.set(key, value);
    },
  };
}
