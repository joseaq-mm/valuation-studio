// Days since a thesis/KPI was last updated, and whether the company has PUBLISHED earnings
// after that update → "stale" (shown in red). Stale means: the analysis predates the most
// recent earnings release that is strictly before today, i.e. there are published results
// the analysis never saw. We also consider next_earnings_date once it has passed, so the
// badge self-corrects even before the cache refreshes.
export function freshnessInfo(updatedAt, lastEarningsDate, nextEarningsDate) {
    if (!updatedAt) return null;
    const upd = new Date(updatedAt);
    if (isNaN(upd.getTime())) return null;
    const days = Math.max(0, Math.floor((Date.now() - upd.getTime()) / 86400000));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    // Most recent earnings date that is STRICTLY before today.
    const strictlyPast = (iso) => {
        if (!iso) return null;
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return d.getTime() < todayStart.getTime() ? d.getTime() : null;
    };
    let lastRelease = strictlyPast(lastEarningsDate);
    const nextPast = strictlyPast(nextEarningsDate);
    if (nextPast != null) lastRelease = Math.max(lastRelease ?? 0, nextPast);

    const stale = lastRelease != null && lastRelease > upd.getTime();
    return { days, stale };
}

export function freshnessTip(info, noun = "la última actualización") {
    if (!info) return "";
    const base = `Días transcurridos desde ${noun}.`;
    return info.stale
        ? `${base} En rojo: la empresa ha publicado resultados después de esa fecha — conviene reanalizar.`
        : base;
}
