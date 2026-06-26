// Days since a thesis/KPI was last updated, and whether the company has reported a
// newer quarter (most_recent_quarter) AFTER that update → "stale" (shown in red).
export function freshnessInfo(updatedAt, mostRecentQuarter) {
    if (!updatedAt) return null;
    const upd = new Date(updatedAt);
    if (isNaN(upd.getTime())) return null;
    const days = Math.max(0, Math.floor((Date.now() - upd.getTime()) / 86400000));
    let stale = false;
    if (mostRecentQuarter) {
        const mrq = new Date(mostRecentQuarter);
        if (!isNaN(mrq.getTime()) && mrq.getTime() > upd.getTime()) stale = true;
    }
    return { days, stale };
}

export function freshnessTip(info, noun = "la última actualización") {
    if (!info) return "";
    const base = `Días transcurridos desde ${noun}.`;
    return info.stale
        ? `${base} En rojo: la empresa ha publicado resultados de un trimestre posterior — conviene reanalizar.`
        : base;
}
