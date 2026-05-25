const KEY = "valstudio_watchlist_v2";
const LEGACY_KEY = "valstudio_watchlist_v1";

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
    _write(list);
    return list;
};

export const removeFromWatchlist = (ticker) => {
    const t = ticker.toUpperCase();
    const list = _read().filter(e => e.ticker !== t);
    _write(list);
    return list;
};
