import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { cloudWatchlistPut, cloudPortfolioPut, cloudWatchlistDelete, cloudPortfolioDelete } from "@/lib/api";
import { getWatchlist, getWatchlistDeletions } from "@/lib/storage";
import { getPortfolio, getPortfolioDeletions } from "@/lib/portfolio";
import { runFullSync } from "@/lib/cloudSync";

// Headless component. When logged in, MongoDB is the source of truth for Nivel 1 + Nivel 2:
//   - React Query polls the cloud every 10s + on window focus/reconnect, reconciling into the
//     local cache so changes made on another device appear here automatically (no reload).
//   - Local mutations write through to the cloud immediately (add/edit debounced PUT,
//     delete via the authoritative endpoint). The server enforces deletions (tombstones).
//   - On logout, syncing stops; localStorage keeps working for anonymous users.
const POLL_MS = 10000;

export default function WatchlistCloudSync() {
    const { user } = useAuth();
    const wlTimer = useRef(null);
    const pfTimer = useRef(null);
    const initialised = useRef(false);

    const q = useQuery({
        queryKey: ["cloudSync", user?.user_id],
        queryFn: runFullSync,
        enabled: !!user,
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 5000,
        retry: 1,
    });

    useEffect(() => {
        if (!user) { initialised.current = false; return; }
        if (q.isSuccess) initialised.current = true;
    }, [user, q.isSuccess]);

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
        const flush = () => {
            if (!initialised.current) return;
            if (wlTimer.current) { clearTimeout(wlTimer.current); wlTimer.current = null; cloudWatchlistPut(getWatchlist(), getWatchlistDeletions()).catch(() => {}); }
            if (pfTimer.current) { clearTimeout(pfTimer.current); pfTimer.current = null; cloudPortfolioPut(getPortfolio(), getPortfolioDeletions()).catch(() => {}); }
        };
        const onVis = () => { if (document.visibilityState === "hidden") flush(); };
        // Authoritative, immediate deletion — hits the server directly so no stale client can resurrect it.
        const onWlDel = (e) => { if (initialised.current && e.detail) cloudWatchlistDelete(e.detail).catch(() => {}); };
        const onPfDel = (e) => { if (initialised.current && e.detail) cloudPortfolioDelete(e.detail).catch(() => {}); };
        window.addEventListener("vs:watchlist-changed", onWl);
        window.addEventListener("vs:portfolio-changed", onPf);
        window.addEventListener("vs:watchlist-deleted", onWlDel);
        window.addEventListener("vs:portfolio-deleted", onPfDel);
        window.addEventListener("pagehide", flush);
        document.addEventListener("visibilitychange", onVis);
        return () => {
            window.removeEventListener("vs:watchlist-changed", onWl);
            window.removeEventListener("vs:portfolio-changed", onPf);
            window.removeEventListener("vs:watchlist-deleted", onWlDel);
            window.removeEventListener("vs:portfolio-deleted", onPfDel);
            window.removeEventListener("pagehide", flush);
            document.removeEventListener("visibilitychange", onVis);
            clearTimeout(wlTimer.current);
            clearTimeout(pfTimer.current);
        };
    }, [user]);

    return null;
}
