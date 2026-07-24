import { cloudWatchlistGet, cloudWatchlistPut, cloudPortfolioGet, cloudPortfolioPut } from "@/lib/api";
import { getWatchlist, replaceWatchlist, getWatchlistDeletions, replaceWatchlistDeletions } from "@/lib/storage";
import { getPortfolio, replacePortfolio, getPortfolioDeletions, replacePortfolioDeletions } from "@/lib/portfolio";

// Tombstone-aware + cloud-authoritative reconciliation between this device and the cloud.
//
// Two mechanisms make deletions propagate reliably across devices:
//  1) Tombstones: a removal records { TICKER: deletedAtISO }; an entry is dropped when it
//     was deleted at/after its last save. Re-adding later (newer saved_at) wins.
//  2) Cloud-authoritative fallback: even if a tombstone never reached the cloud, a local-only
//     entry (missing from the cloud) whose saved_at is <= our last successful sync means the
//     cloud dropped it since → it was deleted elsewhere → drop it. Entries newer than the last
//     sync are genuine offline additions → keep them.
// ISO-8601 UTC strings compare correctly lexicographically.
const DEL_TTL_MS = 60 * 86400000;
const LAST_KEY = "vs.cloudsync.last";

const getLast = () => { try { return localStorage.getItem(LAST_KEY) || ""; } catch { return ""; } };
const setLast = (iso) => { try { localStorage.setItem(LAST_KEY, iso); } catch { /* ignore */ } };

function reconcile(localEntries, localDel, cloudEntries, cloudDel, lastSyncAt) {
    const T = (e) => (e.ticker || "").toUpperCase();

    const del = { ...(localDel || {}) };
    for (const [tk, ts] of Object.entries(cloudDel || {})) {
        const k = (tk || "").toUpperCase();
        if (!k) continue;
        if (!del[k] || ts > del[k]) del[k] = ts;
    }

    const cloudBy = new Map((cloudEntries || []).map((e) => [T(e), e]));
    const localBy = new Map((localEntries || []).map((e) => [T(e), e]));
    const tickers = new Set([...cloudBy.keys(), ...localBy.keys()]);

    const entries = [];
    for (const k of tickers) {
        const c = cloudBy.get(k);
        const l = localBy.get(k);
        const chosen = (c && l) ? (((c.saved_at || "") >= (l.saved_at || "")) ? c : l) : (c || l);
        const savedAt = chosen.saved_at || "";
        const d = del[k];

        if (d && d >= savedAt) continue;                 // deleted at/after last save → stays deleted
        if (c) { entries.push(chosen); if (d) delete del[k]; continue; }  // present in cloud → keep (cloud is truth)
        // local-only (cloud no longer has it):
        if (lastSyncAt && savedAt && savedAt <= lastSyncAt) continue;   // existed at last sync, cloud dropped it → deleted elsewhere
        entries.push(chosen);                             // genuine new local addition → keep
    }

    const cutoff = new Date(Date.now() - DEL_TTL_MS).toISOString();
    for (const [k, ts] of Object.entries(del)) if (ts < cutoff) delete del[k];

    return { entries, deletions: del };
}

// Stable, order/field-noise-insensitive signature of a list, so polling only
// touches the local cache (and re-renders the UI) when something actually changed.
const _norm = (e) => ({
    t: (e.ticker || "").toUpperCase(),
    m: e.mode || "auto",
    o: (e.overrides && Object.keys(e.overrides).length) ? e.overrides : null,
    a: !!e.alert_enabled,
    s: e.shares ?? null, bp: e.buy_price ?? null, bc: e.buy_currency ?? null, bd: e.buy_date ?? null, n: e.note ?? null,
});
const _sig = (list) => JSON.stringify((list || []).map(_norm).sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0)));

// Pull cloud → reconcile with local → update local cache (only on real change) → push
// back (only when the cloud differs). Runs on login and on the React Query polling loop,
// so changes made on another device appear here automatically without a reload.
export async function runFullSync() {
    const lastSyncAt = getLast();
    const [wlRes, pfRes] = await Promise.all([cloudWatchlistGet(), cloudPortfolioGet()]);
    const localWl = getWatchlist(), localPf = getPortfolio();
    const cloudWl = wlRes.entries || [], cloudPf = pfRes.positions || [];
    const cloudWlDel = wlRes.deletions || {}, cloudPfDel = pfRes.deletions || {};

    const wl = reconcile(localWl, getWatchlistDeletions(), cloudWl, cloudWlDel, lastSyncAt);
    const pf = reconcile(localPf, getPortfolioDeletions(), cloudPf, cloudPfDel, lastSyncAt);

    replaceWatchlistDeletions(wl.deletions);   // silent (no UI event)
    replacePortfolioDeletions(pf.deletions);
    if (_sig(wl.entries) !== _sig(localWl)) replaceWatchlist(wl.entries);   // dispatches → UI refresh
    if (_sig(pf.entries) !== _sig(localPf)) replacePortfolio(pf.entries);

    const pushes = [];
    if (_sig(wl.entries) !== _sig(cloudWl) || JSON.stringify(wl.deletions) !== JSON.stringify(cloudWlDel)) {
        pushes.push(cloudWatchlistPut(wl.entries, wl.deletions));
    }
    if (_sig(pf.entries) !== _sig(cloudPf) || JSON.stringify(pf.deletions) !== JSON.stringify(cloudPfDel)) {
        pushes.push(cloudPortfolioPut(pf.entries, pf.deletions));
    }
    if (pushes.length) await Promise.all(pushes);

    setLast(new Date().toISOString());
    return { watchlist: wl.entries.length, portfolio: pf.entries.length };
}

export { reconcile };
