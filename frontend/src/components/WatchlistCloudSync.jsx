import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { cloudWatchlistGet, cloudWatchlistPut } from "@/lib/api";
import { getWatchlist, replaceWatchlist } from "@/lib/storage";

// Headless component: keeps localStorage watchlist in sync with the per-user
// cloud copy when the user is logged in.
//   - On login: pull cloud → merge with local (local-only tickers kept) → push.
//   - On any subsequent local change: debounce 800ms then push to cloud.
//   - On logout: stop syncing (localStorage stays untouched).
export default function WatchlistCloudSync() {
    const { user } = useAuth();
    const pushTimer = useRef(null);
    const initialised = useRef(false);

    // Initial pull + merge whenever the user changes
    useEffect(() => {
        if (!user) {
            initialised.current = false;
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const { entries: cloud } = await cloudWatchlistGet();
                if (cancelled) return;
                const local = getWatchlist();
                const byTicker = new Map(local.map(e => [e.ticker, e]));
                for (const e of (cloud || [])) byTicker.set(e.ticker, e);
                const merged = Array.from(byTicker.values());
                // Avoid loop: only write if the merged result differs from local
                if (JSON.stringify(merged) !== JSON.stringify(local)) {
                    replaceWatchlist(merged);
                }
                // Push the canonical merged list back to the cloud
                await cloudWatchlistPut(merged);
                initialised.current = true;
            } catch {
                /* silent — the sync button in the header lets the user retry */
            }
        })();
        return () => { cancelled = true; };
    }, [user]);

    // Subscribe to local changes and debounce-push them
    useEffect(() => {
        if (!user) return;
        const onChange = (e) => {
            if (!initialised.current) return;
            const next = e.detail || getWatchlist();
            clearTimeout(pushTimer.current);
            pushTimer.current = setTimeout(() => {
                cloudWatchlistPut(next).catch(() => { /* silent */ });
            }, 800);
        };
        window.addEventListener("vs:watchlist-changed", onChange);
        return () => {
            window.removeEventListener("vs:watchlist-changed", onChange);
            clearTimeout(pushTimer.current);
        };
    }, [user]);

    return null;
}
