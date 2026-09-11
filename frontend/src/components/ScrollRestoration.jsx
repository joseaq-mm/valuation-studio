import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Global scroll-position memory, mounted once in Layout so it applies to every page
// without any per-page code. React Router reuses the SAME location.key when returning
// to an already-visited history entry (browser back/forward, or navigate(-1) — e.g.
// BackButton) — a genuinely new navigation always gets a fresh key. That distinction is
// exactly what tells us whether to restore a saved position or start at the top.
//
// Native browser scroll restoration usually gets this right on its own, but SPAs that
// (re)fetch data on mount break it: right after a back-navigation the page is briefly
// shorter than it was (data still loading), so the one-shot restore the browser attempts
// gets clamped and never retried once the page grows back to its full height. The
// ResizeObserver below keeps re-attempting the scroll as the page's height changes,
// so the position lands correctly once the content has actually loaded back in.
const STORAGE_KEY = "vs:scroll-positions";
const MAX_ENTRIES = 50;

const readMap = () => {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
};
const writeMap = (map) => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* quota / private mode — best effort */ }
};

export default function ScrollRestoration() {
    const location = useLocation();

    // Take the browser's own restoration out of the picture entirely — we drive it.
    useEffect(() => {
        if ("scrollRestoration" in window.history) {
            const prev = window.history.scrollRestoration;
            window.history.scrollRestoration = "manual";
            return () => { window.history.scrollRestoration = prev; };
        }
    }, []);

    // Continuously persist the current page's scroll position (rAF-throttled) so it's
    // already up to date by the time the user navigates away — capturing it "on the
    // way out" doesn't work, since by then the new page has already replaced this one.
    useEffect(() => {
        let raf = null;
        const save = () => {
            raf = null;
            const map = readMap();
            map[location.key] = window.scrollY;
            const keys = Object.keys(map);
            if (keys.length > MAX_ENTRIES) delete map[keys[0]];
            writeMap(map);
        };
        const onScroll = () => { if (raf == null) raf = requestAnimationFrame(save); };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            window.removeEventListener("scroll", onScroll);
            if (raf != null) cancelAnimationFrame(raf);
        };
    }, [location.key]);

    // Arriving at a location: restore its saved position (revisited via back/forward),
    // or start at the top (a genuinely new navigation has no saved entry yet).
    useEffect(() => {
        const target = readMap()[location.key];
        if (target == null) {
            window.scrollTo(0, 0);
            return;
        }
        let cancelled = false;
        let attempts = 0;
        const tryScroll = () => {
            if (cancelled) return;
            attempts += 1;
            window.scrollTo(0, target);
            if (Math.abs(window.scrollY - target) > 2 && attempts < 20) {
                setTimeout(tryScroll, 50);
            }
        };
        tryScroll();
        const ro = new ResizeObserver(() => { if (!cancelled) tryScroll(); });
        ro.observe(document.body);
        const stopObserving = setTimeout(() => ro.disconnect(), 2500);
        return () => { cancelled = true; ro.disconnect(); clearTimeout(stopObserving); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key]);

    return null;
}
