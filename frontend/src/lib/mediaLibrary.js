// Generic local media/exports library backed by IndexedDB. Reusable for any
// user-generated artifact (timeline clips now; thesis/trend PDFs, Word, etc later).
// Item shape:
// { id, kind, name, mime, blob, thumbnail (dataURL|null), size, duration, meta, createdAt, cloudUrl? }

const DB_NAME = "vs_media_library";
const STORE = "items";
const VERSION = 1;

let _dbPromise = null;

const openDB = () => {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const os = db.createObjectStore(STORE, { keyPath: "id" });
                os.createIndex("kind", "kind", { unique: false });
                os.createIndex("createdAt", "createdAt", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _dbPromise;
};

const tx = async (mode) => {
    const db = await openDB();
    return db.transaction(STORE, mode).objectStore(STORE);
};

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export const addMediaItem = async ({ kind, name, mime, blob, thumbnail = null, duration = null, meta = {} }) => {
    const store = await tx("readwrite");
    const item = {
        id: uid(), kind, name, mime, blob, thumbnail, duration, meta,
        size: blob?.size || 0, createdAt: new Date().toISOString(), cloudUrl: null,
    };
    return new Promise((resolve, reject) => {
        const r = store.add(item);
        r.onsuccess = () => resolve(item);
        r.onerror = () => reject(r.error);
    });
};

export const listMediaItems = async (kind = null) => {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
        const out = [];
        const r = store.openCursor();
        r.onsuccess = () => {
            const cur = r.result;
            if (cur) {
                if (!kind || cur.value.kind === kind) out.push(cur.value);
                cur.continue();
            } else {
                out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
                resolve(out);
            }
        };
        r.onerror = () => reject(r.error);
    });
};

export const countMediaItems = async (kind = null) => {
    const items = await listMediaItems(kind);
    return items.length;
};

export const getMediaItem = async (id) => {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
        const r = store.get(id);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
    });
};

export const updateMediaItem = async (id, patch) => {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
        const g = store.get(id);
        g.onsuccess = () => {
            const cur = g.result;
            if (!cur) return resolve(null);
            const next = { ...cur, ...patch };
            const p = store.put(next);
            p.onsuccess = () => resolve(next);
            p.onerror = () => reject(p.error);
        };
        g.onerror = () => reject(g.error);
    });
};

export const deleteMediaItem = async (id) => {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
        const r = store.delete(id);
        r.onsuccess = () => resolve(true);
        r.onerror = () => reject(r.error);
    });
};

export const deleteMediaItems = async (ids) => {
    await Promise.all(ids.map((id) => deleteMediaItem(id)));
    return true;
};

export const clearMediaItems = async (kind = null) => {
    const items = await listMediaItems(kind);
    await deleteMediaItems(items.map((i) => i.id));
    return items.length;
};
