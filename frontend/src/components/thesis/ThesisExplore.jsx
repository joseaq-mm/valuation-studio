import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, TrendingUp, Building2, BarChart3, ChevronRight, MousePointerClick, Trash2 } from "lucide-react";
import { squarify, relColor } from "@/lib/treemap";

const VIEWS = [
    { id: "megatrends", label: "Megatendencias", icon: Layers },
    { id: "trends", label: "Tesis", icon: TrendingUp },
    { id: "companies_score", label: "Empresas · score medio", icon: Building2 },
    { id: "companies_tam", label: "Empresas · TAM total", icon: BarChart3 },
];
const H = 440;

const fmtTam = (b) => (b == null ? null : b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : b >= 10 ? `$${Math.round(b)}B` : `$${b}B`);

function buildItems(view, path, dash) {
    const folders = dash?.folders || [], trends = dash?.trends || [], companies = dash?.companies || [];
    const trendItems = (list) => list.map((t) => ({
        type: "trend", id: t.id, name: t.title,
        value: t.tam_busd > 0 ? t.tam_busd : Math.max(t.company_count, 1),
        metric: t.tam_busd, sub: `${t.company_count} emp.`, badge: fmtTam(t.tam_busd),
    }));
    const companiesOfTrend = (entry) => {
        const t = trends.find((x) => x.id === entry.id);
        return (t?.companies || []).filter((c) => c.overall_score != null).map((c) => ({
            type: "company", ticker: c.ticker, name: c.name || c.ticker,
            value: Math.max(c.overall_score, 1), metric: c.overall_score,
            sub: c.ticker || "", badge: c.overall_score,
        }));
    };
    if (view === "megatrends") {
        if (path.length === 0) {
            return folders.map((f) => ({
                type: "folder", id: f.id, name: f.name, trend_count: f.trend_count,
                value: f.tam_busd > 0 ? f.tam_busd : Math.max(f.trend_count, 1),
                metric: f.tam_busd, sub: `${f.trend_count} tesis`, badge: fmtTam(f.tam_busd),
            }));
        }
        if (path.length === 1) return trendItems(trends.filter((t) => t.folder_id === path[0].id));
        return companiesOfTrend(path[1]);
    }
    if (view === "trends") {
        if (path.length === 0) return trendItems(trends);
        return companiesOfTrend(path[0]);
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

export default function ThesisExplore({ dash, onDeleteFolder }) {
    const navigate = useNavigate();
    const [view, setView] = useState("megatrends");
    const [path, setPath] = useState([]);
    const wrapRef = useRef(null);
    const [w, setW] = useState(760);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const items = useMemo(() => buildItems(view, path, dash), [view, path, dash]);
    const metrics = items.map((it) => it.metric).filter((m) => m != null);
    const min = metrics.length ? Math.min(...metrics) : 0;
    const max = metrics.length ? Math.max(...metrics) : 1;
    const laid = useMemo(() => squarify(items, w, H), [items, w]);

    const changeView = (id) => { setView(id); setPath([]); };
    const onCell = (it) => {
        if (it.type === "folder") setPath([{ type: "folder", id: it.id, name: it.name }]);
        else if (it.type === "trend") setPath((p) => [...p, { type: "trend", id: it.id, name: it.name }]);
        else if (it.type === "company" && it.ticker) navigate(`/company/${it.ticker}`);
    };

    const viewLabel = VIEWS.find((v) => v.id === view)?.label;
    const drillable = items.length > 0 && (items[0].type === "folder" || items[0].type === "trend");

    return (
        <div data-testid="thesis-explore">
            {/* View switcher */}
            <div className="flex flex-wrap gap-0 border border-black w-fit mb-3" data-testid="explore-views">
                {VIEWS.map((v, i) => {
                    const Icon = v.icon;
                    const active = view === v.id;
                    return (
                        <button
                            key={v.id}
                            onClick={() => changeView(v.id)}
                            className={`px-3 py-2 text-xs uppercase tracking-[0.1em] font-semibold flex items-center gap-1.5 transition-colors ${i > 0 ? "border-l border-black" : ""} ${active ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
                            data-testid={`explore-view-${v.id}`}
                        >
                            <Icon size={13} /> {v.label}
                        </button>
                    );
                })}
            </div>

            {/* Breadcrumb + legend */}
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <div className="flex items-center gap-1 text-xs text-[#4A4A4A] flex-wrap" data-testid="explore-breadcrumb">
                    <button onClick={() => setPath([])} className="hover:underline font-semibold">{viewLabel}</button>
                    {path.map((p, i) => (
                        <span key={i} className="flex items-center gap-1">
                            <ChevronRight size={12} />
                            {p.type === "trend" ? (
                                <button
                                    onClick={() => navigate(`/thesis/${p.id}`)}
                                    className="underline text-[#052049] hover:text-[#B32A22] font-medium"
                                    title="Abrir esta tesis"
                                    data-testid={`breadcrumb-trend-${p.id}`}
                                >
                                    {p.name}
                                </button>
                            ) : (
                                <button onClick={() => setPath(path.slice(0, i + 1))} className="hover:underline">{p.name}</button>
                            )}
                        </span>
                    ))}
                    {drillable && <span className="flex items-center gap-1 text-[#9CA3AF] ml-1"><MousePointerClick size={12} /> clic para explorar</span>}
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
                        {view.startsWith("companies")
                            ? "Aún no hay empresas con datos suficientes en tus tesis."
                            : "Aún no hay datos para esta vista. Genera o guarda tesis para verlas aquí."}
                    </div>
                )}
                {laid.map((it, idx) => {
                    const big = it.w > 56 && it.h > 30;
                    const med = it.w > 38 && it.h > 20;
                    const bg = it.metric != null ? relColor(it.metric, min, max) : "#9CA3AF";
                    return (
                        <div
                            key={it.id || it.ticker || idx}
                            role="button"
                            tabIndex={0}
                            onClick={() => onCell(it)}
                            onKeyDown={(e) => { if (e.key === "Enter") onCell(it); }}
                            title={`${it.name}${it.badge != null ? ` · ${it.badge}` : ""}`}
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
                El tamaño de cada cuadrado es proporcional a {view === "megatrends" || view === "trends" ? "su TAM (potencial de mercado)" : view === "companies_score" ? "su score global medio" : "la suma de sus TAM Scores"}, relativo al resto. El color va de verde (alto) a rojo (bajo).
            </p>
        </div>
    );
}
