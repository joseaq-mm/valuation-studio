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

export const setAllPositionAlerts = (enabled) => {
    const list = _read().map(p => ({ ...p, alert_enabled: !!enabled }));
    _write(list);
    return list;
};

export const setPositionAlert = (ticker, enabled) => {
    const t = (ticker || "").toUpperCase();
    const list = _read().map(p => (p.ticker || "").toUpperCase() === t ? { ...p, alert_enabled: !!enabled } : p);
    _write(list);
    return list;
};

export const getPortfolioEntry = (ticker) => {
    const t = (ticker || "").toUpperCase();
    return _read().find(p => (p.ticker || "").toUpperCase() === t) || null;
};

// Save manual overrides on a portfolio position. If the position doesn't
// exist yet, we create a "tracking-only" entry (no shares/buy_price) with
// the overrides attached. Pass overrides=null to clear overrides and revert
// the entry back to auto mode (without removing it from the portfolio).
export const savePortfolioOverrides = (ticker, overrides) => {
    if (!ticker) return _read();
    const t = ticker.toUpperCase();
    const list = _read();
    const idx = list.findIndex(p => (p.ticker || "").toUpperCase() === t);
    if (idx === -1) {
        list.push({
            ticker: t,
            shares: null,
            buy_price: null,
            mode: overrides ? "manual" : "auto",
            overrides: overrides || null,
            saved_at: new Date().toISOString(),
            alert_enabled: true,
        });
    } else {
        list[idx] = {
            ...list[idx],
            mode: overrides ? "manual" : "auto",
            overrides: overrides || null,
            saved_at: new Date().toISOString(),
        };
    }
    _write(list);
    return list;
};
