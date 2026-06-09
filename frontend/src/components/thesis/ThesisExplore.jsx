import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, TrendingUp, Building2, BarChart3, Share2, ChevronRight, MousePointerClick, Trash2, Check } from "lucide-react";
import { squarify, relColor } from "@/lib/treemap";

// Left group = the "what's growing" entities; right group = the completed-company scores.
const VIEWS = [
    { id: "megatrends", label: "Megatendencias", icon: Layers, group: "left" },
    { id: "tendencias", label: "Tendencias", icon: TrendingUp, group: "left" },
    { id: "convergence", label: "Convergencia", icon: Share2, group: "left" },
    { id: "companies_score", label: "Empresas · score medio", icon: Building2, group: "right" },
    { id: "companies_tam", label: "Empresas · TAM total", icon: BarChart3, group: "right" },
];
const H = 440;

const fmtTam = (b) => (b == null ? null : b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : b >= 10 ? `$${Math.round(b)}B` : `$${b}B`);
const fmtCagr = (v) => (v == null ? null : `${v > 0 ? "+" : ""}${v}%`);

function buildItems(view, path, dash, minConv) {
    const folders = dash?.folders || [], tendencias = dash?.tendencias || [], companies = dash?.companies || [];
    // A tendencia cell: size ∝ forward 4y CAGR; shows CAGR% (badge) + TAM (sub).
    const tendenciaItems = (list) => list.map((t) => ({
        type: "tendencia", id: t.id, name: t.title,
        value: t.cagr_4y > 0 ? t.cagr_4y : 1,
        metric: t.cagr_4y, sub: fmtTam(t.tam_busd) || "", badge: fmtCagr(t.cagr_4y),
    }));
    if (view === "megatrends") {
        if (path.length === 0) {
            return folders.map((f) => ({
                type: "folder", id: f.id, name: f.name, tendencia_count: f.tendencia_count,
                value: f.cagr_4y > 0 ? f.cagr_4y : Math.max(f.tendencia_count || 0, 1),
                metric: f.cagr_4y, sub: fmtTam(f.tam_busd) || `${f.tendencia_count || 0} tend.`,
                badge: fmtCagr(f.cagr_4y),
            }));
        }
        return tendenciaItems(tendencias.filter((t) => t.folder_id === path[0].id));
    }
    if (view === "tendencias") return tendenciaItems(tendencias);
    if (view === "convergence") {
        // Companies appearing in ≥ minConv of the user's tendencias. Size ∝ count.
        return (dash?.convergence || []).filter((c) => c.count >= minConv).map((c) => ({
            type: "convergence", ticker: c.ticker, name: c.name || c.ticker,
            value: c.count, metric: c.count, badge: c.count,
            sub: `${c.count} tendencias`,
            analyzed: c.analyzed, company_thesis_id: c.company_thesis_id,
            leader: c.leader, competitor: c.competitor, disruptor: c.disruptor,
        }));
    }
    if (view === "companies_score") {
        return companies.filter((c) => c.avg_overall_score != null).map((c) => ({
            type: "company", ticker: c.ticker, name: c.name || c.ticker,
            value: Math.max(c.avg_overall_score, 1), metric: c.avg_overall_score,
            sub: c.ticker, badge: c.avg_overall_score,
        }));
    }
    return companies.filter((c) => c.sum_tam_score != null && c.sum_tam_score > 0).map((c) => ({
        type: "company", ticker: c.ticker, name: c.name || c.ticker,
        value: c.sum_tam_score, metric: c.sum_tam_score, sub: c.ticker, badge: c.sum_tam_score.toFixed(2),
    }));
}

const catMix = (it) => [
    it.leader ? `${it.leader} líder` : null,
    it.competitor ? `${it.competitor} compet.` : null,
    it.disruptor ? `${it.disruptor} disrupt.` : null,
].filter(Boolean).join(" · ");

export default function ThesisExplore({ dash, onDeleteFolder, onPrepareThesis }) {
    const navigate = useNavigate();
    const [view, setView] = useState("megatrends");
    const [path, setPath] = useState([]);
    const [minConv, setMinConv] = useState(2);
    const wrapRef = useRef(null);
    const [w, setW] = useState(760);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const items = useMemo(() => buildItems(view, path, dash, minConv), [view, path, dash, minConv]);
    const metrics = items.map((it) => it.metric).filter((m) => m != null);
    const min = metrics.length ? Math.min(...metrics) : 0;
    const max = metrics.length ? Math.max(...metrics) : 1;
    const laid = useMemo(() => squarify(items, w, H), [items, w]);
    const maxConvCount = useMemo(() => (dash?.convergence || []).reduce((m, c) => Math.max(m, c.count), 2), [dash]);

    const changeView = (id) => { setView(id); setPath([]); };
    const onCell = (it) => {
        if (it.type === "folder") setPath([{ type: "folder", id: it.id, name: it.name }]);
        else if (it.type === "tendencia" && it.id) navigate(`/thesis/${it.id}`);
        else if (it.type === "company" && it.ticker) navigate(`/company/${it.ticker}`);
        else if (it.type === "convergence" && it.ticker) {
            // Already analyzed → open its company thesis; otherwise prepare a new one.
            if (it.analyzed && it.company_thesis_id) navigate(`/thesis/${it.company_thesis_id}`);
            else onPrepareThesis?.(it.ticker);
        }
    };

    const viewLabel = VIEWS.find((v) => v.id === view)?.label;
    const drillable = items.length > 0 && items[0].type === "folder";
    const leftViews = VIEWS.filter((v) => v.group === "left");
    const rightViews = VIEWS.filter((v) => v.group === "right");

    const caption = view === "megatrends"
        ? "El tamaño de cada megatendencia es proporcional a la MEDIA del crecimiento compuesto a 4 años (CAGR) de sus tendencias; el badge muestra ese CAGR y el subtítulo el TAM total (suma)."
        : view === "tendencias"
            ? "El tamaño de cada tendencia es proporcional a su crecimiento compuesto a 4 años (CAGR); el badge muestra el CAGR y el subtítulo el TAM 2027e."
            : view === "convergence"
                ? "Empresas que aparecen en varias de tus tendencias (convergencia de megatendencias). El tamaño y el badge son el nº de tendencias; ✓ = ya tiene tesis de empresa desarrollada (clic para abrirla); si no, el clic la prepara en «Empresa → Tesis»."
                : view === "companies_score"
                    ? "El tamaño de cada empresa es proporcional a su score global medio (solo empresas completamente desarrolladas)."
                    : "El tamaño de cada empresa es proporcional a la suma de sus TAM Scores (solo empresas completamente desarrolladas).";

    const ViewBtn = ({ v, i, n }) => {
        const Icon = v.icon;
        const active = view === v.id;
        return (
            <button
                onClick={() => changeView(v.id)}
                className={`px-3 py-2 text-xs uppercase tracking-[0.1em] font-semibold flex items-center gap-1.5 transition-colors ${i > 0 ? "border-l border-black" : ""} ${active ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                data-testid={`explore-view-${v.id}`}
            >
                <Icon size={13} /> {v.label}
            </button>
        );
    };

    return (
        <div data-testid="thesis-explore">
            {/* View switcher: left group (entities) + right group (completed-company scores) */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3" data-testid="explore-views">
                <div className="flex border border-black w-fit">
                    {leftViews.map((v, i) => <ViewBtn key={v.id} v={v} i={i} />)}
                </div>
                <div className="flex border border-black w-fit" data-testid="explore-views-right">
                    {rightViews.map((v, i) => <ViewBtn key={v.id} v={v} i={i} />)}
                </div>
            </div>

            {/* Breadcrumb + (convergence threshold) + legend */}
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <div className="flex items-center gap-2 text-xs text-[#4A4A4A] flex-wrap" data-testid="explore-breadcrumb">
                    <button onClick={() => setPath([])} className="hover:underline font-semibold">{viewLabel}</button>
                    {path.map((p, i) => (
                        <span key={i} className="flex items-center gap-1">
                            <ChevronRight size={12} />
                            <button onClick={() => setPath(path.slice(0, i + 1))} className="hover:underline">{p.name}</button>
                        </span>
                    ))}
                    {drillable && <span className="flex items-center gap-1 text-[#9CA3AF] ml-1"><MousePointerClick size={12} /> clic para explorar</span>}
                    {view === "convergence" && (
                        <label className="flex items-center gap-1.5 ml-1" data-testid="convergence-threshold-wrap">
                            <span>Aparece en ≥</span>
                            <select
                                value={minConv}
                                onChange={(e) => setMinConv(Number(e.target.value))}
                                className="border border-black bg-white px-1.5 py-0.5 text-xs outline-none cursor-pointer font-semibold"
                                data-testid="convergence-threshold"
                            >
                                {Array.from({ length: Math.max(1, maxConvCount - 1) }, (_, k) => k + 2).map((n) => (
                                    <option key={n} value={n}>{n}</option>
                                ))}
                            </select>
                            <span>tendencias</span>
                        </label>
                    )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-[#4A4A4A]">
                    <span>alto</span>
                    <span className="inline-block w-24 h-2.5 rounded-sm" style={{ background: "linear-gradient(90deg, rgb(30,125,69), rgb(184,134,11), rgb(179,42,34))" }} />
                    <span>bajo</span>
                </div>
            </div>

            {/* Treemap */}
            <div ref={wrapRef} className="relative w-full border border-black bg-[#FDF1E6] overflow-hidden" style={{ height: H }} data-testid="explore-treemap">
                {laid.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-[#4A4A4A] px-6" data-testid="explore-empty">
                        {view === "convergence"
                            ? "Aún no hay empresas que coincidan en varias tendencias. Crea más tendencias con «Tendencias → Empresas» para ver las convergencias."
                            : view.startsWith("companies")
                                ? "Aún no hay empresas completamente desarrolladas. Planifica una empresa y genera todas sus tesis para verla aquí."
                                : "Aún no hay tendencias. Usa «Tendencias → Empresas» para crear una y agrúpalas en megatendencias."}
                    </div>
                )}
                {laid.map((it, idx) => {
                    const big = it.w > 56 && it.h > 30;
                    const med = it.w > 38 && it.h > 20;
                    const bg = it.metric != null ? relColor(it.metric, min, max) : "#9CA3AF";
                    const tip = it.type === "convergence"
                        ? `${it.name} · ${it.count} tendencias${catMix(it) ? ` · ${catMix(it)}` : ""}${it.analyzed ? " · ✓ analizada" : " · pendiente"}`
                        : `${it.name}${it.badge != null ? ` · ${it.badge}` : ""}${it.sub ? ` · ${it.sub}` : ""}`;
                    return (
                        <div
                            key={it.id || it.ticker || idx}
                            role="button"
                            tabIndex={0}
                            onClick={() => onCell(it)}
                            onKeyDown={(e) => { if (e.key === "Enter") onCell(it); }}
                            title={tip}
                            className="absolute text-left overflow-hidden border border-[#FDF1E6] hover:brightness-110 hover:z-10 transition-all cursor-pointer"
                            style={{ left: it.x, top: it.y, width: it.w, height: it.h, background: bg }}
                            data-testid={`explore-cell-${it.type}-${it.id || it.ticker || idx}`}
                        >
                            <div className="p-1.5 h-full flex flex-col justify-between text-[#FDF1E6]" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>
                                {med && (
                                    <div className={`font-semibold leading-tight ${big ? "text-sm" : "text-[11px]"} line-clamp-3 pr-4`}>
                                        {it.name}
                                    </div>
                                )}
                                {big && (
                                    <div className="flex items-center justify-between gap-1 text-[10px]">
                                        <span className="truncate opacity-90">{it.sub}</span>
                                        {it.badge != null && <span className="font-mono font-bold shrink-0">{it.badge}</span>}
                                    </div>
                                )}
                            </div>
                            {it.type === "convergence" && it.analyzed && it.w > 30 && it.h > 22 && (
                                <span className="absolute top-1 right-1 bg-[#1E7D45] text-white rounded-full p-0.5" title="Ya tiene tesis de empresa desarrollada" data-testid={`convergence-analyzed-${it.ticker}`}>
                                    <Check size={10} />
                                </span>
                            )}
                            {it.type === "folder" && onDeleteFolder && it.w > 44 && it.h > 28 && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDeleteFolder(it); }}
                                    title="Eliminar megatendencia"
                                    className="absolute top-1 right-1 p-1 bg-black/25 hover:bg-black/55 text-[#FDF1E6] transition-colors"
                                    data-testid={`explore-delete-folder-${it.id}`}
                                >
                                    <Trash2 size={11} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            <p className="text-sm text-[#1a1a1a] font-medium mt-3 leading-relaxed" data-testid="explore-caption">
                {caption} El color va de verde (alto) a rojo (bajo).
            </p>
        </div>
    );
}
