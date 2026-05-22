const KEY = "valstudio_watchlist_v1";

export const getWatchlist = () => {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

export const addToWatchlist = (ticker) => {
    const list = getWatchlist();
    const t = ticker.toUpperCase();
    if (!list.includes(t)) {
        list.push(t);
        localStorage.setItem(KEY, JSON.stringify(list));
    }
    return list;
};

export const removeFromWatchlist = (ticker) => {
    const list = getWatchlist().filter(t => t !== ticker.toUpperCase());
    localStorage.setItem(KEY, JSON.stringify(list));
    return list;
};

export const isInWatchlist = (ticker) => getWatchlist().includes(ticker.toUpperCase());
