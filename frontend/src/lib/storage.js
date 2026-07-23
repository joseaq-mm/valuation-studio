const KEY = "valstudio_watchlist_v2";
const LEGACY_KEY = "valstudio_watchlist_v1";
const DEL_KEY = "valstudio_watchlist_deletions_v1";  // { TICKER: deletedAtISO } tombstones for cross-device deletions

/**
 * Watchlist entry shape:
 * { ticker: "AAPL", mode: "auto"|"manual", overrides: {field: value, ...} | null, saved_at: ISOString }
 *
 * Only fields the user explicitly edited (and that differ from Yahoo's auto values)
 * are stored in `overrides`. Price is NEVER stored — it always refreshes from Yahoo.
 */

const _read = () => {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
        // Migrate legacy v1 ["AAPL", "MSFT"] → v2 entries
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
            const arr = JSON.parse(legacy);
            const migrated = (arr || []).map(t => ({ ticker: t, mode: "auto", overrides: null, saved_at: new Date().toISOString() }));
            localStorage.setItem(KEY, JSON.stringify(migrated));
            return migrated;
        }
        return [];
    } catch { return []; }
};

const _write = (list) => {
    localStorage.setItem(KEY, JSON.stringify(list));
    // Notify subscribers (e.g. cloud sync hook) about the change
    try { window.dispatchEvent(new CustomEvent("vs:watchlist-changed", { detail: list })); } catch { /* ignore */ }
};

// --- Deletion tombstones (so removals propagate across devices instead of resurrecting) ---
const _readDel = () => {
    try { return JSON.parse(localStorage.getItem(DEL_KEY) || "{}") || {}; } catch { return {}; }
};
const _writeDel = (map) => { localStorage.setItem(DEL_KEY, JSON.stringify(map || {})); };
export const getWatchlistDeletions = () => _readDel();
export const replaceWatchlistDeletions = (map) => { _writeDel(map || {}); return map || {}; };

export const setAllWatchlistAlerts = (enabled) => {
    const list = _read().map(e => ({ ...e, alert_enabled: !!enabled }));
    _write(list);
    return list;
};

export const setWatchlistAlert = (ticker, enabled) => {
    const t = (ticker || "").toUpperCase();
    const list = _read().map(e => (e.ticker || "").toUpperCase() === t ? { ...e, alert_enabled: !!enabled } : e);
    _write(list);
    return list;
};

export const replaceWatchlist = (list) => {
    const safe = Array.isArray(list) ? list : [];
    _write(safe);
    return safe;
};

export const getWatchlist = () => _read();

export const getWatchlistTickers = () => _read().map(e => e.ticker);

export const getWatchlistEntry = (ticker) => {
    const t = ticker.toUpperCase();
    return _read().find(e => e.ticker === t) || null;
};

export const isInWatchlist = (ticker) => !!getWatchlistEntry(ticker);

/**
 * Save a ticker to the watchlist. If overrides is a non-empty object, mode = manual.
 * If overrides is null/empty, mode = auto. Replaces any existing entry for the ticker.
 */
export const saveToWatchlist = (ticker, overrides = null) => {
    const t = ticker.toUpperCase();
    const list = _read().filter(e => e.ticker !== t);
    const hasOverrides = overrides && Object.keys(overrides).length > 0;
    list.push({
        ticker: t,
        mode: hasOverrides ? "manual" : "auto",
        overrides: hasOverrides ? overrides : null,
        saved_at: new Date().toISOString(),
    });
    const del = _readDel();
    if (del[t]) { delete del[t]; _writeDel(del); }  // re-added → clear any tombstone
    _write(list);
    return list;
};

export const removeFromWatchlist = (ticker) => {
    const t = ticker.toUpperCase();
    const list = _read().filter(e => e.ticker !== t);
    const del = _readDel();
    del[t] = new Date().toISOString();  // tombstone so the deletion syncs to other devices
    _writeDel(del);
    _write(list);
    try { window.dispatchEvent(new CustomEvent("vs:watchlist-deleted", { detail: t })); } catch { /* ignore */ }
    return list;
};
