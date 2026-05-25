// Portfolio (real positions) storage. Lives in localStorage for anonymous
// users; WatchlistCloudSync mirrors this to the cloud when logged in.
const KEY = "vs.portfolio.v1";

const _read = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};

const _write = (list) => {
    localStorage.setItem(KEY, JSON.stringify(list));
    try { window.dispatchEvent(new CustomEvent("vs:portfolio-changed", { detail: list })); } catch { /* ignore */ }
};

export const getPortfolio = () => _read();

export const replacePortfolio = (list) => {
    const safe = Array.isArray(list) ? list : [];
    _write(safe);
    return safe;
};

export const upsertPosition = (pos) => {
    if (!pos || !pos.ticker) return _read();
    const list = _read();
    const t = pos.ticker.toUpperCase();
    const idx = list.findIndex(p => (p.ticker || "").toUpperCase() === t);
    const next = { ...pos, ticker: t };
    if (idx >= 0) list[idx] = { ...list[idx], ...next };
    else list.push(next);
    _write(list);
    return list;
};

export const removePosition = (ticker) => {
    const t = (ticker || "").toUpperCase();
    const list = _read().filter(p => (p.ticker || "").toUpperCase() !== t);
    _write(list);
    return list;
};

export const setPositionAlert = (ticker, enabled) => {
    const t = (ticker || "").toUpperCase();
    const list = _read().map(p => (p.ticker || "").toUpperCase() === t ? { ...p, alert_enabled: !!enabled } : p);
    _write(list);
    return list;
};
