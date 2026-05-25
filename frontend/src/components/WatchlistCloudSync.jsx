import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { cloudWatchlistGet, cloudWatchlistPut, cloudPortfolioGet, cloudPortfolioPut } from "@/lib/api";
import { getWatchlist, replaceWatchlist } from "@/lib/storage";
import { getPortfolio, replacePortfolio } from "@/lib/portfolio";

// Headless component: keeps localStorage watchlist + portfolio in sync with the
// per-user cloud copies when the user is logged in.
//   - On login: pull cloud → merge with local → push.
//   - On any subsequent local change: debounce 800ms then push to cloud.
//   - On logout: stop syncing (localStorage stays untouched).
function mergeByTicker(local, cloud) {
    const byTicker = new Map(local.map(e => [(e.ticker || "").toUpperCase(), e]));
    for (const e of (cloud || [])) byTicker.set((e.ticker || "").toUpperCase(), e);
    return Array.from(byTicker.values());
}

export default function WatchlistCloudSync() {
    const { user } = useAuth();
    const wlTimer = useRef(null);
    const pfTimer = useRef(null);
    const initialised = useRef(false);

    useEffect(() => {
        if (!user) {
            initialised.current = false;
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const [{ entries: cloudWl }, { positions: cloudPf }] = await Promise.all([
                    cloudWatchlistGet(),
                    cloudPortfolioGet(),
                ]);
                if (cancelled) return;
                const mergedWl = mergeByTicker(getWatchlist(), cloudWl || []);
                const mergedPf = mergeByTicker(getPortfolio(), cloudPf || []);
                replaceWatchlist(mergedWl);
                replacePortfolio(mergedPf);
                await Promise.all([
                    cloudWatchlistPut(mergedWl),
                    cloudPortfolioPut(mergedPf),
                ]);
                initialised.current = true;
            } catch {
                /* silent — the sync button in the header lets the user retry */
            }
        })();
        return () => { cancelled = true; };
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const onWl = (e) => {
            if (!initialised.current) return;
            const next = e.detail || getWatchlist();
            clearTimeout(wlTimer.current);
            wlTimer.current = setTimeout(() => {
                cloudWatchlistPut(next).catch(() => { /* silent */ });
            }, 800);
        };
        const onPf = (e) => {
            if (!initialised.current) return;
            const next = e.detail || getPortfolio();
            clearTimeout(pfTimer.current);
            pfTimer.current = setTimeout(() => {
                cloudPortfolioPut(next).catch(() => { /* silent */ });
            }, 800);
        };
        window.addEventListener("vs:watchlist-changed", onWl);
        window.addEventListener("vs:portfolio-changed", onPf);
        return () => {
            window.removeEventListener("vs:watchlist-changed", onWl);
            window.removeEventListener("vs:portfolio-changed", onPf);
            clearTimeout(wlTimer.current);
            clearTimeout(pfTimer.current);
        };
    }, [user]);

    return null;
}
