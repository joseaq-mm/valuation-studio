import React, { useState, useEffect, useCallback } from "react";
import { Newspaper, Search, Trash2, Loader2, ExternalLink, Rss } from "lucide-react";
import { kpiNewsList, kpiNewsSearch, kpiNewsDelete } from "@/lib/api";
import { toast } from "sonner";

const sentColor = (s) => (s === "positivo" ? "#1D7044" : s === "negativo" ? "#B32A22" : "#7A7A7A");
const sentLabel = (s) => (s === "positivo" ? "+" : s === "negativo" ? "−" : "•");

// Qualitative news per company. INFORMS the scores (fed to the judge on Reanalyze),
// ages out via 45-day decay (max 15), incorporates Radar news, has its own search.
export default function KpiNews({ companyId }) {
    const [news, setNews] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searching, setSearching] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try { const d = await kpiNewsList(companyId); setNews(d.news || []); }
        catch { setNews([]); }
        finally { setLoading(false); }
    }, [companyId]);

    useEffect(() => { load(); }, [load]);

    const search = async () => {
        if (searching) return;
        setSearching(true);
        try {
            const res = await kpiNewsSearch(companyId);
            const result = res?.result || res;
            setNews(result?.news || []);
            toast.success(`Noticias actualizadas (${result?.found ?? 0} encontradas)`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error buscando noticias");
        } finally { setSearching(false); }
    };

    const remove = async (n) => {
        setNews((prev) => prev.filter((x) => x.id !== n.id));
        try { await kpiNewsDelete(companyId, n.id); } catch { load(); }
    };

    return (
        <div className="border border-black/20 bg-white p-3 mb-4" data-testid="kpi-news">
            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5"><Newspaper size={13} /> Noticias ({news.length}) · contexto cualitativo</div>
                <button onClick={search} disabled={searching} className="btn-ghost !py-1 !px-2.5 inline-flex items-center gap-1.5 text-xs disabled:opacity-40" data-testid="kpi-news-search-btn">
                    {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Buscar noticias
                </button>
            </div>
            <p className="text-[11px] text-[#7A7A7A] mb-2">Estas noticias <strong>matizan los scores</strong> al Reanalizar. Las antiguas/poco relevantes se descartan solas (vida media 45 días, máx. 15). Incluye las del Radar.</p>

            {loading && news.length === 0 ? (
                <div className="text-xs text-[#9A9A9A] py-2 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> cargando…</div>
            ) : news.length === 0 ? (
                <div className="text-xs text-[#9A9A9A] py-2 text-center border border-dashed border-black/20">Sin noticias. Pulsa "Buscar noticias".</div>
            ) : (
                <ul className="space-y-1.5" data-testid="kpi-news-list">
                    {news.map((n) => (
                        <li key={n.id} className="flex items-start gap-2 border border-black/10 px-2 py-1.5 text-sm" data-testid={`kpi-news-${n.id}`}>
                            <span className="font-bold mt-0.5 shrink-0" style={{ color: sentColor(n.sentiment) }} title={n.sentiment}>{sentLabel(n.sentiment)}</span>
                            <div className="min-w-0 flex-1">
                                <div className="leading-tight font-medium">{n.headline}</div>
                                {n.why_it_matters && <div className="text-[11px] text-[#7A7A7A] leading-snug mt-0.5">{n.why_it_matters}</div>}
                                <div className="text-[10px] text-[#9A9A9A] mt-0.5 flex items-center gap-2">
                                    {n.published_at && <span>{n.published_at}</span>}
                                    {n.origin === "radar" && <span className="inline-flex items-center gap-0.5 text-[#B8860B]"><Rss size={9} /> Radar</span>}
                                    {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="text-[#052049] inline-flex items-center gap-0.5 hover:underline"><ExternalLink size={9} /> fuente</a>}
                                </div>
                            </div>
                            <button onClick={() => remove(n)} className="text-[#B32A22] hover:bg-[#B32A22]/10 p-1 shrink-0" title="Borrar" data-testid={`kpi-news-delete-${n.id}`}>
                                <Trash2 size={13} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
