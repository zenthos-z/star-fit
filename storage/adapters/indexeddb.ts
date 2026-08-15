const DB_NAME = "starfit_db";
const STORE = "kv";
const META_STORE = "_storage_meta";
const DB_VERSION = 2;
const QUOTA_BYTES = 50 * 1024 * 1024; // 50MB

interface StorageMeta {
  key: string;
  size: number;
  lastAccessed: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let resolved = false;
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.error('[IDB] openDB timeout after 10 seconds');
        reject(new Error('IndexedDB open timeout'));
      }
    }, 10000);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve(req.result);
      }
    };
    req.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(req.error);
      }
    };
    req.onblocked = () => {
      console.warn('[IDB] Database open blocked, waiting...');
    };
  });
}

async function updateMeta(key: string, value: any, isDelete = false): Promise<void> {
  if (key === META_STORE) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    if (isDelete) {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } else {
      const size = value ? JSON.stringify(value).length : 0;
      const meta: StorageMeta = {
        key,
        size,
        lastAccessed: Date.now()
      };
      const req = store.put(meta);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }
  });
}

async function touchMeta(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const meta = getReq.result as StorageMeta;
      if (meta) {
        meta.lastAccessed = Date.now();
        store.put(meta);
      }
      resolve();
    };
    getReq.onerror = () => resolve(); // Ignore meta update errors for GET
  });
}

async function evictIfNecessary(whitelist: string[] = []): Promise<void> {
  const db = await openDB();
  const metas: StorageMeta[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const store = tx.objectStore(META_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  let totalSize = metas.reduce((sum, m) => sum + m.size, 0);
  if (totalSize <= QUOTA_BYTES) return;

  // Sort by lastAccessed ASC (oldest first)
  const sorted = metas
    .filter(m => !whitelist.some(w => m.key === w || m.key.startsWith(w)))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);

  console.log(`[LRU] Total size ${totalSize} exceeds quota ${QUOTA_BYTES}. Starting eviction...`);

  for (const m of sorted) {
    if (totalSize <= QUOTA_BYTES * 0.8) break; // Evict until 80% full
    await idbRemove(m.key);
    totalSize -= m.size;
    console.log(`[LRU] Evicted: ${m.key}, Freed: ${m.size}`);
  }
}

async function withStore(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<any>) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((v) => {
        if (tx.commit) tx.commit();
        resolve(v);
      })
      .catch(reject);
  });
}

export async function idbGet<T = any>(key: string): Promise<T | null> {
  const db = await openDB();
  const result = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });

  if (result) {
    // Background touch meta
    touchMeta(key).catch(() => {});
  }
  return result;
}

export async function idbSet(key: string, value: any, whitelist: string[] = []): Promise<void> {
  await withStore("readwrite", async (store) => {
    return new Promise((resolve, reject) => {
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
  await updateMeta(key, value);
  // Periodically evict (maybe don't do it on every set if performance is an issue)
  evictIfNecessary(whitelist).catch(err => console.error("[LRU] Eviction failed", err));
}

export async function idbRemove(key: string): Promise<void> {
  await withStore("readwrite", async (store) => {
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  });
  await updateMeta(key, null, true);
}

export async function idbKeys(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

export async function idbClear(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => {
      console.log(`[IDB] Database ${DB_NAME} deleted successfully.`);
      resolve();
    };
    req.onerror = () => {
      console.error(`[IDB] Failed to delete database ${DB_NAME}.`);
      reject(req.error);
    };
    req.onblocked = () => {
      console.warn(`[IDB] Deletion of ${DB_NAME} is blocked. Please close other tabs.`);
      resolve(); // Still resolve to not block the app
    };
  });
}

