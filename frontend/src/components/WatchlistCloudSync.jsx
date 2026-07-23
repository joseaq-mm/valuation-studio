import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { cloudWatchlistPut, cloudPortfolioPut } from "@/lib/api";
import { getWatchlist, getWatchlistDeletions } from "@/lib/storage";
import { getPortfolio, getPortfolioDeletions } from "@/lib/portfolio";
import { runFullSync } from "@/lib/cloudSync";

// Headless component: keeps localStorage watchlist + portfolio in sync with the
// per-user cloud copies when the user is logged in.
//   - On login/reload: pull cloud → tombstone-aware reconcile → push (see runFullSync).
//   - On any subsequent local change: debounce 800ms then push entries + deletions.
//   - On logout: stop syncing (localStorage stays untouched).
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
                await runFullSync();
                if (!cancelled) initialised.current = true;
            } catch {
                /* silent — the sync button in the header lets the user retry */
            }
        })();
        return () => { cancelled = true; };
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const onWl = () => {
            if (!initialised.current) return;
            clearTimeout(wlTimer.current);
            wlTimer.current = setTimeout(() => {
                cloudWatchlistPut(getWatchlist(), getWatchlistDeletions()).catch(() => { /* silent */ });
            }, 800);
        };
        const onPf = () => {
            if (!initialised.current) return;
            clearTimeout(pfTimer.current);
            pfTimer.current = setTimeout(() => {
                cloudPortfolioPut(getPortfolio(), getPortfolioDeletions()).catch(() => { /* silent */ });
            }, 800);
        };
        // If the user closes/backgrounds the tab before the debounce fires, flush now so
        // pending changes (especially deletions) reach the cloud instead of being lost.
        const flush = () => {
            if (!initialised.current) return;
            if (wlTimer.current) { clearTimeout(wlTimer.current); wlTimer.current = null; cloudWatchlistPut(getWatchlist(), getWatchlistDeletions()).catch(() => {}); }
            if (pfTimer.current) { clearTimeout(pfTimer.current); pfTimer.current = null; cloudPortfolioPut(getPortfolio(), getPortfolioDeletions()).catch(() => {}); }
        };
        const onVis = () => { if (document.visibilityState === "hidden") flush(); };
        window.addEventListener("vs:watchlist-changed", onWl);
        window.addEventListener("vs:portfolio-changed", onPf);
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", onVis);
        return () => {
            window.removeEventListener("vs:watchlist-changed", onWl);
            window.removeEventListener("vs:portfolio-changed", onPf);
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", onVis);
            clearTimeout(wlTimer.current);
            clearTimeout(pfTimer.current);
        };
    }, [user]);

    return null;
}
