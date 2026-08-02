import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Layers, TrendingUp, Building2, BarChart3, Share2, ChevronRight, MousePointerClick, Trash2, Check, Maximize2, X } from "lucide-react";
import { squarify, relColor } from "@/lib/treemap";
import PinchZoomPane from "@/components/PinchZoomPane";

/** Measures its own box and lays out the treemap for that size (so it works
 *  both inline at a fixed height and stretched full-screen). Renders each laid
 *  cell through the `cell` render prop. */
function TreemapSurface({ items, height, fill = false, cell, empty, className, testid, zoom = 1 }) {
    const ref = useRef(null);
    const [dim, setDim] = useState({ w: 760, h: typeof height === "number" ? height : 440 });
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver((e) => {
            const r = e[0].contentRect;
            setDim({ w: r.width, h: fill ? r.height : (typeof height === "number" ? height : r.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [fill, height]);
    const laid = useMemo(() => squarify(items, dim.w, dim.h || 440), [items, dim.w, dim.h]);
    return (
        <div ref={ref} className={className} style={fill ? undefined : { height }} data-testid={testid}>
            {laid.length === 0 ? empty : laid.map((it, i) => cell(it, i, zoom))}
        </div>
    );
}


// Left group = the "what's growing" entities; right group = the completed-company scores.
const VIEWS = [
    { id: "megatrends", label: "Megatendencias", icon: Layers, group: "left", desc: "Tus megatendencias (carpetas que agrupan tendencias). El tamaño del cuadro es la MEDIA del crecimiento a 4 años (CAGR) de sus tendencias y muestra el TAM total (suma)." },
    { id: "tendencias", label: "Tendencias", icon: TrendingUp, group: "left", desc: "Tus tendencias (creadas con «Tendencias → Empresas»). El tamaño del cuadro es su crecimiento compuesto a 4 años (CAGR) y muestra el TAM estimado a 2027." },
    { id: "convergence", label: "Convergencia", icon: Share2, group: "left", desc: "Empresas que aparecen en VARIAS de tus tendencias a la vez (señal de convergencia de megatendencias). El tamaño es el nº de tendencias en las que aparece." },
    { id: "companies_score", label: "Empresas · score medio", icon: Building2, group: "right", desc: "Tus empresas completamente desarrolladas (todas sus tesis generadas), ordenadas por su score global medio. El tamaño del cuadro es ese score." },
    { id: "companies_tam", label: "Empresas · TAM total", icon: BarChart3, group: "right", desc: "Tus empresas completamente desarrolladas (todas sus tesis generadas), por TAM total. El tamaño del cuadro es la suma de sus TAM Score." },
];
const H = 440;

const fmtTam = (b) => (b == null ? null : b >= 1000 ? `$${(b / 1000).toFixed(1)}T` : b >= 10 ? `$${Math.round(b)}B` : `$${b}B`);
const fmtCagr = (v) => (v == null ? null : `${v > 0 ? "+" : ""}${v}%`);

function buildItems(view, path, dash, minConv, tendMetric) {
    const folders = dash?.folders || [], tendencias = dash?.tendencias || [], companies = dash?.companies || [];
    // A tendencia cell. `mode` decides what drives the size/color:
    //   "cagr"  → CAGR 4a (badge CAGR, sub TAM)
    //   "tam"   → TAM 2027e (badge TAM, sub CAGR)
    //   "media" → media normalizada 0–100 de TAM y CAGR (badge índice, sub CAGR · TAM)
    const tendenciaItems = (list, mode = "cagr") => {
        if (mode === "tam") {
            return list.map((t) => ({
                type: "tendencia", id: t.id, name: t.title,
                value: t.tam_busd > 0 ? t.tam_busd : 1,
                metric: t.tam_busd, sub: fmtCagr(t.cagr_4y) || "", badge: fmtTam(t.tam_busd),
            }));
        }
        if (mode === "media") {
            const tams = list.map((t) => t.tam_busd).filter((v) => v != null);
            const cagrs = list.map((t) => t.cagr_4y).filter((v) => v != null);
            const nrm = (x, arr) => {
                if (x == null || !arr.length) return null;
                const mn = Math.min(...arr), mx = Math.max(...arr);
                return mx === mn ? 50 : ((x - mn) / (mx - mn)) * 100;
            };
            return list.map((t) => {
                const parts = [nrm(t.tam_busd, tams), nrm(t.cagr_4y, cagrs)].filter((v) => v != null);
                const media = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
                return {
                    type: "tendencia", id: t.id, name: t.title,
                    value: media != null ? Math.max(media, 1) : 1,
                    metric: media, badge: media != null ? Math.round(media) : null,
                    sub: `${fmtCagr(t.cagr_4y) || "—"} · ${fmtTam(t.tam_busd) || "—"}`,
                };
            });
        }
        return list.map((t) => ({
            type: "tendencia", id: t.id, name: t.title,
            value: t.cagr_4y > 0 ? t.cagr_4y : 1,
            metric: t.cagr_4y, sub: fmtTam(t.tam_busd) || "", badge: fmtCagr(t.cagr_4y),
        }));
    };
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
    if (view === "tendencias") return tendenciaItems(tendencias, tendMetric);
    if (view === "convergence") {
        // Companies appearing in ≥ minConv of the user's tendencias. Size ∝ count.
        return (dash?.convergence || []).filter((c) => c.count >= minConv).map((c) => ({
            type: "convergence", ticker: c.ticker, name: c.name || c.ticker,
            value: c.count, metric: c.count, badge: c.count,
            sub: `${c.count} ${c.count === 1 ? "tendencia" : "tendencias"}`,
            analyzed: c.analyzed, company_thesis_id: c.company_thesis_id,
            leader: c.leader, competitor: c.competitor, disruptor: c.disruptor,
            tendencias: c.tendencias || [],
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

const CAT_LABEL = { leader: "Líder", competitor: "Competidor", disruptor: "Disruptor" };

/** View-switcher button (module-level so it isn't remounted on every parent re-render —
 *  that was leaving the tooltip "stuck"). Tooltip is anchored under the button, set on
 *  enter and cleared on leave. */
function ViewBtn({ v, i, active, onSelect, onTip }) {
    const Icon = v.icon;
    return (
        <button
            onClick={onSelect}
            onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); onTip({ text: v.desc, x: r.left, y: r.bottom }); }}
            onMouseLeave={() => onTip(null)}
            className={`px-3 py-2 text-xs uppercase tracking-[0.1em] font-semibold flex items-center gap-1.5 transition-colors ${i > 0 ? "border-l border-black" : ""} ${active ? "bg-black text-[#FDF1E6]" : "bg-white text-black hover:bg-[#F5E4D4]"}`}
            data-testid={`explore-view-${v.id}`}
        >
            <Icon size={13} /> {v.label}
        </button>
    );
}

/** Rich, structured tooltip shown on cell hover (follows the cursor, clamped to viewport). */
function CellTooltip({ item, x, y }) {
    if (!item) return null;
    const W = 320;
    const left = Math.min(x + 14, (typeof window !== "undefined" ? window.innerWidth : 1920) - W - 12);
    const top = y + 16;
    const mix = [
        item.leader ? `${item.leader} ${item.leader === 1 ? "líder" : "líderes"}` : null,
        item.competitor ? `${item.competitor} ${item.competitor === 1 ? "competidor" : "competidores"}` : null,
        item.disruptor ? `${item.disruptor} ${item.disruptor === 1 ? "disruptor" : "disruptores"}` : null,
    ].filter(Boolean).join(" · ");
    return (
        <div
            role="tooltip"
            style={{ position: "fixed", top, left, width: W, zIndex: 60, pointerEvents: "none" }}
            className="bg-[#111111] text-white border border-black shadow-lg p-3 text-xs leading-relaxed"
            data-testid="explore-tooltip"
        >
            {item.type === "convergence" ? (
                <>
                    <div className="font-serif text-base font-medium leading-tight">
                        {item.name} {item.ticker && <span className="font-mono text-[#FDE9D2] text-xs">({item.ticker})</span>}
                    </div>
                    {mix && <div className="text-[#FDE9D2] mt-0.5">{mix}</div>}
                    <div className="mt-2 mb-1 uppercase tracking-[0.1em] text-[10px] text-[#C9C2B8]">
                        Aparece en {item.count} {item.count === 1 ? "tendencia" : "tendencias"}
                    </div>
                    <ul className="space-y-1">
                        {(item.tendencias || []).map((t, i) => (
                            <li key={i} className="flex items-start gap-2">
                                <span className="text-[#B8860B] mt-0.5">•</span>
                                <span><span className="font-medium">{t.title}</span> <span className="text-[#C9C2B8]">— {CAT_LABEL[t.category] || "Competidor"}</span></span>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-2 pt-2 border-t border-white/15 text-[#C9C2B8]">
                        Estado: <span className="text-white font-medium">{item.analyzed ? "Ya tiene tesis de empresa desarrollada" : "Pendiente de analizar"}</span>
                    </div>
                </>
            ) : (
                <>
                    <div className="font-serif text-base font-medium leading-tight">{item.name}</div>
                    {item.badge != null && <div className="text-[#FDE9D2] mt-0.5 font-mono">{item.badge}</div>}
                    {item.sub && <div className="text-[#C9C2B8] mt-0.5">{item.sub}</div>}
                </>
            )}
        </div>
    );
}

export default function ThesisExplore({ dash, onDeleteFolder, onPrepareThesis }) {
    const navigate = useNavigate();
    const [view, setView] = useState("megatrends");
    const [path, setPath] = useState([]);
    const [minConv, setMinConv] = useState(2);
    const [tendMetric, setTendMetric] = useState("cagr");  // cagr | tam | media (solo vista Tendencias)
    const [tip, setTip] = useState(null);
    const [btnTip, setBtnTip] = useState(null);
    const [treeFull, setTreeFull] = useState(false);
    const [treeZoom, setTreeZoom] = useState(1);

    // Lock scroll + ESC while the treemap is expanded full-screen.
    useEffect(() => {
        if (!treeFull) { setTreeZoom(1); return; }
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        const onKey = (e) => { if (e.key === "Escape") setTreeFull(false); };
        window.addEventListener("keydown", onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
    }, [treeFull]);

    const items = useMemo(() => buildItems(view, path, dash, minConv, tendMetric), [view, path, dash, minConv, tendMetric]);
    const metrics = items.map((it) => it.metric).filter((m) => m != null);
    const min = metrics.length ? Math.min(...metrics) : 0;
    const max = metrics.length ? Math.max(...metrics) : 1;
    const maxConvCount = useMemo(() => (dash?.convergence || []).reduce((m, c) => Math.max(m, c.count), 2), [dash]);

    const changeView = (id) => { setView(id); setPath([]); setTip(null); };
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
            ? (tendMetric === "tam"
                ? "El tamaño de cada tendencia es proporcional a su TAM estimado a 2027; el badge muestra el TAM y el subtítulo el crecimiento compuesto a 4 años (CAGR). Así comparas las tendencias por tamaño de mercado."
                : tendMetric === "media"
                    ? "El tamaño de cada tendencia combina —media normalizada 0–100— su TAM y su CAGR, para ver qué tendencias destacan en AMBAS variables a la vez; el badge muestra ese índice combinado (0–100) y el subtítulo el CAGR y el TAM."
                    : "El tamaño de cada tendencia es proporcional a su crecimiento compuesto a 4 años (CAGR); el badge muestra el CAGR y el subtítulo el TAM 2027e. Así comparas las tendencias por ritmo de crecimiento.")
            : view === "convergence"
                ? "Empresas que aparecen en varias de tus tendencias (convergencia de megatendencias). El tamaño y el badge son el nº de tendencias; ✓ = ya tiene tesis de empresa desarrollada (clic para abrirla); si no, el clic la prepara en «Empresa → Tesis»."
                : view === "companies_score"
                    ? "El tamaño de cada empresa es proporcional a su score global medio (solo empresas completamente desarrolladas)."
                    : "El tamaño de cada empresa es proporcional a la suma de sus TAM Scores (solo empresas completamente desarrolladas).";

    const emptyEl = (
        <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-[#4A4A4A] px-6" data-testid="explore-empty">
            {view === "convergence"
                ? "Aún no hay empresas que coincidan en varias tendencias. Crea más tendencias con «Tendencias → Empresas» para ver las convergencias."
                : view.startsWith("companies")
                    ? "Aún no hay empresas completamente desarrolladas. Planifica una empresa y genera todas sus tesis para verla aquí."
                    : "Aún no hay tendencias. Usa «Tendencias → Empresas» para crear una y agrúpalas en megatendencias."}
        </div>
    );

    const renderCell = (it, idx, zoom = 1) => {
        // Reveal labels based on the EFFECTIVE on-screen size (layout size × zoom),
        // so zooming into a dense treemap surfaces the small cells' names.
        const ew = it.w * zoom, eh = it.h * zoom;
        const big = ew > 56 && eh > 30;
        const med = ew > 38 && eh > 20;
        const bg = it.metric != null ? relColor(it.metric, min, max) : "#9CA3AF";
        return (
            <div
                key={it.id || it.ticker || idx}
                role="button"
                tabIndex={0}
                onClick={() => onCell(it)}
                onKeyDown={(e) => { if (e.key === "Enter") onCell(it); }}
                onMouseEnter={(e) => setTip({ item: it, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : { item: it, x: e.clientX, y: e.clientY }))}
                onMouseLeave={() => setTip(null)}
                className={`absolute text-left overflow-hidden hover:brightness-110 hover:z-10 transition-all cursor-pointer ${it.type === "convergence" && it.count >= 2 ? "border-2 border-[#D4AF37]" : "border border-[#FDF1E6]"}`}
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
    };

    return (
        <div data-testid="thesis-explore">
            {/* View switcher: left group (entities) + right group (completed-company scores) */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3" data-testid="explore-views">
                <div className="min-w-0 max-w-full overflow-x-auto">
                <div className="flex border border-black w-fit">
                    {leftViews.map((v, i) => (
                        v.id === "tendencias" ? (
                            <div key={v.id} className={`flex items-stretch ${i > 0 ? "border-l border-black" : ""}`}>
                                <ViewBtn v={v} i={0} active={view === v.id} onSelect={() => changeView(v.id)} onTip={setBtnTip} />
                                {view === "tendencias" && (
                                    <select
                                        value={tendMetric}
                                        onChange={(e) => setTendMetric(e.target.value)}
                                        className="bg-black text-[#FDF1E6] text-[11px] uppercase tracking-[0.06em] font-semibold pl-2 pr-1 border-l border-[#FDF1E6]/30 outline-none cursor-pointer"
                                        title="Elige qué variable dimensiona las tendencias"
                                        data-testid="tendencias-metric"
                                    >
                                        <option value="cagr">por CAGR</option>
                                        <option value="tam">por TAM</option>
                                        <option value="media">media (TAM+CAGR)</option>
                                    </select>
                                )}
                            </div>
                        ) : (
                            <ViewBtn key={v.id} v={v} i={i} active={view === v.id} onSelect={() => changeView(v.id)} onTip={setBtnTip} />
                        )
                    ))}
                </div>
                </div>
                <div className="min-w-0 max-w-full overflow-x-auto">
                <div className="flex border border-black w-fit" data-testid="explore-views-right">
                    {rightViews.map((v, i) => <ViewBtn key={v.id} v={v} i={i} active={view === v.id} onSelect={() => changeView(v.id)} onTip={setBtnTip} />)}
                </div>
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
                <div className="flex items-center gap-3 text-[10px] text-[#4A4A4A]">
                    {view === "convergence" && (
                        <span className="flex items-center gap-1" data-testid="convergence-gold-legend">
                            <span className="inline-block w-3 h-3 border-2 border-[#D4AF37] bg-transparent" />
                            Borde dorado en la empresa o empresas incluidas en más tendencias
                        </span>
                    )}
                    <span className="flex items-center gap-1.5">
                        <span>alto</span>
                        <span className="inline-block w-24 h-2.5 rounded-sm" style={{ background: "linear-gradient(90deg, rgb(30,125,69), rgb(184,134,11), rgb(179,42,34))" }} />
                        <span>bajo</span>
                    </span>
                </div>
            </div>

            {/* Treemap */}
            <div className="relative">
                <button
                    onClick={() => setTreeFull(true)}
                    className="absolute top-2 right-2 z-10 overline text-xs px-3 py-1.5 border border-black bg-white/90 hover:bg-black hover:text-white transition flex items-center gap-1.5 shadow"
                    data-testid="explore-expand-treemap"
                    title="Ampliar el mapa a pantalla completa (pellizca para hacer zoom)"
                >
                    <Maximize2 size={12} /> Ampliar
                </button>
                <TreemapSurface
                    items={items}
                    height={H}
                    cell={renderCell}
                    empty={emptyEl}
                    className="relative w-full border border-black bg-[#FDF1E6] overflow-hidden"
                    testid="explore-treemap"
                />
            </div>
            <p className="text-sm text-[#1a1a1a] font-medium mt-3 leading-relaxed" data-testid="explore-caption">
                {caption} El color va de verde (alto) a rojo (bajo).
            </p>
            {tip && <CellTooltip item={tip.item} x={tip.x} y={tip.y} />}
            {btnTip && (
                <div
                    role="tooltip"
                    style={{ position: "fixed", top: btnTip.y + 8, left: Math.min(btnTip.x, (typeof window !== "undefined" ? window.innerWidth : 1920) - 312), width: 300, zIndex: 60, pointerEvents: "none" }}
                    className="bg-[#111111] text-white border border-black shadow-lg px-3 py-2 text-xs leading-relaxed"
                    data-testid="explore-view-tooltip"
                >
                    {btnTip.text}
                </div>
            )}

            {treeFull && (
                <div className="fixed inset-0 z-[70] bg-[#FDF1E6] flex flex-col" data-testid="explore-treemap-fullscreen" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
                    <div className="flex items-center justify-between px-4 py-2 border-b border-black shrink-0 bg-white">
                        <div className="overline text-black truncate">{viewLabel}{path.length ? ` · ${path[path.length - 1].name}` : ""}</div>
                        <button onClick={() => setTreeFull(false)} className="overline text-xs px-3 py-1.5 border border-black hover:bg-black hover:text-white transition flex items-center gap-1.5 shrink-0" data-testid="explore-treemap-fullscreen-close">
                            <X size={14} /> Cerrar
                        </button>
                    </div>
                    <div className="flex-1 min-h-0">
                        <PinchZoomPane className="w-full h-full" onZoom={(s) => setTreeZoom(Math.round(s * 2) / 2)}>
                            <TreemapSurface
                                items={items}
                                fill
                                zoom={treeZoom}
                                cell={renderCell}
                                empty={emptyEl}
                                className="relative w-full h-full bg-[#FDF1E6] overflow-hidden"
                                testid="explore-treemap-full"
                            />
                        </PinchZoomPane>
                    </div>
                    <div className="text-[10px] text-[#7A7A7A] px-4 py-1 text-center shrink-0 bg-white">Pellizca para hacer zoom · arrastra para desplazar · doble toque para restablecer · gira el móvil para más ancho</div>
                </div>
            )}
        </div>
    );
}
