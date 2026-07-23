import { cloudWatchlistGet, cloudWatchlistPut, cloudPortfolioGet, cloudPortfolioPut } from "@/lib/api";
import { getWatchlist, replaceWatchlist, getWatchlistDeletions, replaceWatchlistDeletions } from "@/lib/storage";
import { getPortfolio, replacePortfolio, getPortfolioDeletions, replacePortfolioDeletions } from "@/lib/portfolio";

// Tombstone-aware reconciliation between this device and the cloud.
// - Merges tombstones (latest deletedAt per ticker wins).
// - Unions entries by ticker (newest saved_at wins on conflict).
// - An entry is dropped if it was deleted AFTER its last save (deletion propagates);
//   if it was re-added after the deletion, it survives and the tombstone is cleared.
// - Old tombstones (>60 days) are pruned to avoid unbounded growth.
// ISO-8601 UTC strings compare correctly lexicographically.
const DEL_TTL_MS = 60 * 86400000;

function reconcile(localEntries, localDel, cloudEntries, cloudDel) {
    const del = { ...(localDel || {}) };
    for (const [tk, ts] of Object.entries(cloudDel || {})) {
        const k = (tk || "").toUpperCase();
        if (!k) continue;
        if (!del[k] || ts > del[k]) del[k] = ts;
    }

    const byTicker = new Map();
    for (const e of localEntries || []) byTicker.set((e.ticker || "").toUpperCase(), e);
    for (const e of cloudEntries || []) {
        const k = (e.ticker || "").toUpperCase();
        const prev = byTicker.get(k);
        if (!prev || (e.saved_at || "") >= (prev.saved_at || "")) byTicker.set(k, e);
    }

    const entries = [];
    for (const [k, e] of byTicker) {
        const d = del[k];
        if (d && d >= (e.saved_at || "")) continue;   // deleted after (or at) last save → stays deleted
        if (d) delete del[k];                          // re-added later → deletion no longer applies
        entries.push(e);
    }

    const cutoff = new Date(Date.now() - DEL_TTL_MS).toISOString();
    for (const [k, ts] of Object.entries(del)) if (ts < cutoff) delete del[k];

    return { entries, deletions: del };
}

// Pull cloud → reconcile with local → save locally → push merged result back.
// Used both on login and by the manual "sincronizar" button. Same behaviour as a page reload.
export async function runFullSync() {
    const [wlRes, pfRes] = await Promise.all([cloudWatchlistGet(), cloudPortfolioGet()]);
    const wl = reconcile(getWatchlist(), getWatchlistDeletions(), wlRes.entries || [], wlRes.deletions || {});
    const pf = reconcile(getPortfolio(), getPortfolioDeletions(), pfRes.positions || [], pfRes.deletions || {});

    replaceWatchlistDeletions(wl.deletions);
    replacePortfolioDeletions(pf.deletions);
    replaceWatchlist(wl.entries);
    replacePortfolio(pf.entries);

    await Promise.all([
        cloudWatchlistPut(wl.entries, wl.deletions),
        cloudPortfolioPut(pf.entries, pf.deletions),
    ]);
    return { watchlist: wl.entries.length, portfolio: pf.entries.length };
}
