import React, { useState, useEffect, useCallback } from "react";
import { Newspaper, Search, Trash2, Loader2, ExternalLink, Rss, ChevronDown, ChevronRight, Building2, Plus, X, RefreshCw } from "lucide-react";
import { kpiNewsList, kpiNewsSearch, kpiNewsDelete, kpiIrSourcesGet, kpiIrSourcesSet, kpiIrRefresh } from "@/lib/api";
import HoverTip from "@/components/HoverTip";
import { toast } from "sonner";

const sentColor = (s) => (s === "positivo" ? "#1D7044" : s === "negativo" ? "#B32A22" : "#7A7A7A");
const sentLabel = (s) => (s === "positivo" ? "+" : s === "negativo" ? "−" : "•");
const sentText = (s) => (s === "positivo" ? "Positivo para la tesis" : s === "negativo" ? "Negativo para la tesis" : "Neutral para la tesis");
const SENT_TIP = "Indicador de sentimiento: cómo afecta la noticia a la tesis. Verde (+) = favorable, rojo (−) = desfavorable, gris (•) = neutral. Matiza los scores al Reanalizar.";

// Qualitative news per company. INFORMS the scores (fed to the judge on Reanalyze),
// ages out via 45-day decay (max 15), incorporates Radar news, has its own search.
export default function KpiNews({ companyId, onChanged }) {
    const [news, setNews] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searching, setSearching] = useState(false);
    const [open, setOpen] = useState(false);
    const [irUrls, setIrUrls] = useState([]);
    const [irInput, setIrInput] = useState("");
    const [irRefreshing, setIrRefreshing] = useState(false);
    const [irSaving, setIrSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try { const d = await kpiNewsList(companyId); setNews(d.news || []); }
        catch { setNews([]); }
        finally { setLoading(false); }
    }, [companyId]);

    const loadIr = useCallback(async () => {
        try { const d = await kpiIrSourcesGet(companyId); setIrUrls(d.urls || []); }
        catch { setIrUrls([]); }
    }, [companyId]);

    useEffect(() => { load(); loadIr(); setOpen(false); }, [load, loadIr]);

    const saveIr = async (urls) => {
        setIrSaving(true);
        try { const d = await kpiIrSourcesSet(companyId, urls); setIrUrls(d.urls || []); }
        catch (e) { toast.error(e?.response?.data?.detail || "No se pudieron guardar las fuentes"); loadIr(); }
        finally { setIrSaving(false); }
    };

    const addIr = () => {
        const u = irInput.trim();
        if (!u) return;
        if (irUrls.length >= 10) { toast.message("Máximo 10 fuentes IR"); return; }
        setIrInput("");
        saveIr([...irUrls, u]);
    };

    const removeIr = (u) => saveIr(irUrls.filter((x) => x !== u));

    const refreshIr = async () => {
        if (irRefreshing) return;
        setIrRefreshing(true);
        try {
            const res = await kpiIrRefresh(companyId);
            const result = res?.result || res;
            setNews(result?.news || []);
            setOpen(true);
            toast.success(`Fuentes IR revisadas (${result?.found ?? 0} novedades)`);
            if (result?.found) onChanged?.();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error leyendo las fuentes IR");
        } finally { setIrRefreshing(false); }
    };

    const search = async () => {
        if (searching) return;
        setSearching(true);
        try {
            const res = await kpiNewsSearch(companyId);
            const result = res?.result || res;
            setNews(result?.news || []);
            setOpen(true);
            toast.success(`Noticias actualizadas (${result?.found ?? 0} encontradas)`);
            if (result?.found) onChanged?.();
        } catch (e) {
            toast.error(e?.response?.data?.detail || "Error buscando noticias");
        } finally { setSearching(false); }
    };

    const remove = async (n) => {
        setNews((prev) => prev.filter((x) => x.id !== n.id));
        try { await kpiNewsDelete(companyId, n.id); } catch { load(); }
    };

    const pos = news.filter((n) => n.sentiment === "positivo").length;
    const neg = news.filter((n) => n.sentiment === "negativo").length;

    return (
        <div className="border border-black/20 bg-white p-3 mb-4" data-testid="kpi-news">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 group" data-testid="kpi-news-toggle" aria-expanded={open}>
                    {open ? <ChevronDown size={15} className="text-[#4A4A4A]" /> : <ChevronRight size={15} className="text-[#4A4A4A]" />}
                    <Newspaper size={14} className="text-[#4A4A4A]" />
                    <HoverTip text="Noticias que matizan los scores de tus KPIs al Reanalizar. Puedes buscarlas con IA y, además, añadir las páginas de Investor Relations (IR) de la empresa para que se revisen automáticamente cada día e incorporen sus novedades." maxWidth={300}>
                        <span className="overline text-[#4A4A4A] group-hover:text-black cursor-help">Noticias</span>
                    </HoverTip>
                    {news.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 bg-[#FBF3E0] border border-[#B8860B]/50 text-[#7a5a10]" data-testid="kpi-news-count">
                            {news.length} {news.length === 1 ? "noticia" : "noticias"}
                            {pos > 0 && <span className="text-[#1D7044]">· {pos}+</span>}
                            {neg > 0 && <span className="text-[#B32A22]">· {neg}−</span>}
                        </span>
                    ) : (
                        <span className="text-[11px] text-[#9A9A9A]">— sin noticias</span>
                    )}
                </button>
                <button onClick={search} disabled={searching} className="btn-ghost !py-1 !px-2.5 inline-flex items-center gap-1.5 text-xs disabled:opacity-40" data-testid="kpi-news-search-btn">
                    {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Buscar noticias
                </button>
            </div>

            {open && (
                <>
                    <p className="text-[11px] text-[#7A7A7A] mt-2 mb-2">
                        <HoverTip text={SENT_TIP} maxWidth={300}><span className="cursor-help underline decoration-dotted">Contexto cualitativo</span></HoverTip>
                        {" "}— estas noticias <strong>matizan los scores</strong> al Reanalizar. Las antiguas/poco relevantes se descartan solas (vida media 45 días, máx. 15). Incluye las del Radar.
                    </p>

                    {/* IR (Investor Relations) sources — daily auto-ingest */}
                    <div className="border border-[#052049]/20 bg-[#F4F6FA] p-2.5 mb-3" data-testid="kpi-ir-sources">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5">
                                <Building2 size={13} className="text-[#052049]" />
                                <span className="overline text-[#052049]">Fuentes IR</span>
                                <span className="text-[11px] text-[#7A7A7A] normal-case tracking-normal">{irUrls.length ? `${irUrls.length} configurada${irUrls.length === 1 ? "" : "s"} · revisión diaria` : "— añade la web de noticias/IR de la empresa"}</span>
                            </div>
                            {irUrls.length > 0 && (
                                <button onClick={refreshIr} disabled={irRefreshing} className="btn-ghost !py-1 !px-2.5 inline-flex items-center gap-1.5 text-xs disabled:opacity-40" data-testid="kpi-ir-refresh-btn">
                                    {irRefreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Actualizar desde IR
                                </button>
                            )}
                        </div>
                        <div className="mt-2">
                            <p className="text-[11px] text-[#7A7A7A] mb-2">Pega la URL de la sala de prensa / resultados (IR) de la empresa (admite RSS). Se revisan <strong>automáticamente cada día</strong>; las novedades se añaden aquí, se marcan como “pendiente actualizar” y se suman al Radar semanal.</p>
                            {irUrls.length > 0 && (
                                <ul className="space-y-1 mb-2" data-testid="kpi-ir-list">
                                    {irUrls.map((u) => (
                                        <li key={u} className="flex items-center gap-2 text-xs bg-white border border-black/10 px-2 py-1" data-testid={`kpi-ir-item`}>
                                            <Rss size={11} className="text-[#B8860B] shrink-0" />
                                            <a href={u} target="_blank" rel="noreferrer" className="text-[#052049] truncate flex-1 hover:underline">{u}</a>
                                            <button onClick={() => removeIr(u)} disabled={irSaving} className="text-[#B32A22] hover:bg-[#B32A22]/10 p-0.5 shrink-0" title="Quitar" data-testid="kpi-ir-remove"><X size={13} /></button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="flex items-center gap-2">
                                <input
                                    value={irInput}
                                    onChange={(e) => setIrInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addIr(); } }}
                                    placeholder="https://investor.empresa.com/news  (o feed RSS)"
                                    className="flex-1 border border-black/30 bg-white px-2 py-1 text-xs outline-none focus:border-[#052049]"
                                    data-testid="kpi-ir-input"
                                />
                                <button onClick={addIr} disabled={irSaving || !irInput.trim()} className="btn-primary !py-1 !px-2.5 text-xs inline-flex items-center gap-1 disabled:opacity-40" data-testid="kpi-ir-add">
                                    {irSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Añadir
                                </button>
                            </div>
                        </div>
                    </div>

                    {loading && news.length === 0 ? (
                        <div className="text-xs text-[#9A9A9A] py-2 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> cargando…</div>
                    ) : news.length === 0 ? (
                        <div className="text-xs text-[#9A9A9A] py-2 text-center border border-dashed border-black/20">Sin noticias. Pulsa "Buscar noticias".</div>
                    ) : (
                        <ul className="space-y-1.5" data-testid="kpi-news-list">
                            {news.map((n) => (
                                <li key={n.id} className="flex items-start gap-2 border border-black/10 px-2 py-1.5 text-sm" data-testid={`kpi-news-${n.id}`}>
                                    <HoverTip text={`${sentText(n.sentiment)} — ${SENT_TIP}`} maxWidth={280}>
                                        <span className="font-bold mt-0.5 shrink-0 cursor-help" style={{ color: sentColor(n.sentiment) }} data-testid={`kpi-news-sentiment-${n.id}`}>{sentLabel(n.sentiment)}</span>
                                    </HoverTip>
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
                </>
            )}
        </div>
    );
}
