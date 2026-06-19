import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis } from "recharts";
import { Loader2, RotateCcw, ArrowUp, ArrowDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisVisualData } from "@/lib/api";
import HoverTip from "@/components/HoverTip";
import { signalFor } from "@/lib/thresholds";

// ---------- Helpers ----------
const clamp01 = (v) => (v == null ? 0 : Math.max(0, Math.min(1, v)));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const KPI_BETA = 0.5; // intensidad de la modulación del coeficiente KPI

/** Parte cualitativa base — media normalizada de Score y TAM Score (sin precio, sin KPI). */
const qualBase = (r) => {
    const s = clamp01((r.avg_overall_score || 0) / 100);
    const t = clamp01((r.sum_tam_score || 0) / 30);
    return (s + t) / 2;
};

/** Parte de precio — media normalizada de Ratio Compra y Venta. */
const priceBase = (r) => {
    const rc = clamp01(((r.ratio_compra_pct ?? -50) + 50) / 150);
    const rv = clamp01(((r.ratio_venta_pct ?? -50) + 50) / 150);
    return (rc + rv) / 2;
};

/** Factor KPI relativo: punto neutro = promedio de 1 (absoluto) y la media del universo.
 *  C por encima del neutro mejora el combinado; por debajo lo empeora. Sin KPI → 1 (neutro). */
const kpiFactor = (C, neutro) => {
    if (C == null || typeof C !== "number") return 1;
    return clamp(1 + KPI_BETA * (C - neutro), 0.6, 1.4);
};

// Header tooltips (Score → Combinado total)
const TIP = {
    score: "Score global cualitativo (0–100): media de la calidad de la empresa en las tesis donde aparece. Combina posición competitiva, momentum del sector, calidad del management y resiliencia financiera.",
    tam: "TAM Score (suma): potencial de mercado atribuido a la empresa. Mezcla su calidad con el trozo de TAM que le toca frente a sus ingresos proyectados, sumado en todas sus tesis. >1 = oportunidad grande respecto a su tamaño actual.",
    kpi: "Coeficiente KPI (0,5–1,5): validación operativa de la tesis con datos reales (ARR, NRR, backlog…). C = 1 + 0,5·S, donde S es la señal cuantitativa. >1 = los KPIs confirman la tesis; <1 = la refutan. Modula los combinados respecto a la media del universo. «—» = aún sin analizar en /kpis.",
    combined_qual: "Combinado cualitativo (0–100%): une el Score y el TAM Score, modulado por el coeficiente KPI (relativo a la media de todas las empresas con KPI). Mide la fuerza CUALITATIVA total — calidad + potencial + validación operativa — sin precio.",
    compra: "Ratio de Compra (%): distancia del precio actual al Precio Objetivo de Compra (POC). Positivo y alto = potencialmente barata.",
    venta: "Ratio de Venta (%): distancia del precio actual al Precio Objetivo de Venta (POV). Avisa de cuándo se agota el recorrido al alza.",
    combined: "Combinado total (0–100%): índice global que une calidad + potencial + validación KPI (vía el Combinado cualitativo) y la valoración (Compra/Venta). El coeficiente KPI cuenta una sola vez (no se dobla su peso).",
};

const fmtPct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtN = (v, d = 1) => (v == null ? "—" : v.toFixed(d));
const coefColor = (c) => (c == null ? "#9ca3af" : c > 1.05 ? "#1D7044" : c < 0.95 ? "#B32A22" : "#B8860B");

// ---------- Quadrant background labels (with subtitle) ----------
const QuadrantLabels = () => (
    <>
        {/* TL: low score + alto ratio compra (barata relativa) → trampa */}
        <text x="12%" y="10%" textAnchor="start" fill="#B8860B" fillOpacity={0.55} fontSize={14} fontWeight={700}>⚠️ TRAMPA DE VALOR</text>
        <text x="12%" y="10%" dy={14} textAnchor="start" fill="#B8860B" fillOpacity={0.55} fontSize={10} fontStyle="italic">Calidad baja + barata → auditar bien antes</text>

        {/* TR: high score + alto ratio compra → joya */}
        <text x="88%" y="10%" textAnchor="end" fill="#1D7044" fillOpacity={0.65} fontSize={14} fontWeight={700}>🏆 JOYAS ESCONDIDAS</text>
        <text x="88%" y="10%" dy={14} textAnchor="end" fill="#1D7044" fillOpacity={0.65} fontSize={10} fontStyle="italic">Calidad alta + descuento → comprar</text>

        {/* BL: low score + bajo ratio compra (cara) → sobrevalorada */}
        <text x="12%" y="80%" textAnchor="start" fill="#B32A22" fillOpacity={0.55} fontSize={14} fontWeight={700}>🚫 SOBREVALORADA</text>
        <text x="12%" y="80%" dy={14} textAnchor="start" fill="#B32A22" fillOpacity={0.55} fontSize={10} fontStyle="italic">Calidad baja + cara → ignorar</text>

        {/* BR: high score + bajo ratio compra → premium, esperar */}
        <text x="88%" y="80%" textAnchor="end" fill="#4A4A4A" fillOpacity={0.65} fontSize={14} fontWeight={700}>💎 PREMIUM</text>
        <text x="88%" y="80%" dy={14} textAnchor="end" fill="#4A4A4A" fillOpacity={0.65} fontSize={10} fontStyle="italic">Calidad alta + cara → esperar entrada</text>
    </>
);

// ---------- Custom dot ----------
// Colour is driven by the user's Ratio Venta thresholds (Umbrales cara/justa/barata)
// so that the visual quadrant matches the rest of the app (portfolio, company page).
// The chart subscribes to `vs:thresholds-changed` so when the user opens the dialog
// and edits cheap/fair, the dots re-paint immediately without a full reload.
const colorForRv = (rv) => signalFor(rv, "venta").color;

const Dot = (props) => {
    const { cx, cy, payload } = props;
    const r = Math.max(5, Math.min(22, 4 + Math.sqrt(Math.max(0, payload.sum_tam_score || 0)) * 2.2));
    return (
        <g>
            <circle cx={cx} cy={cy} r={r} fill={colorForRv(payload.ratio_venta_pct)} fillOpacity={0.75} stroke="#000" strokeWidth={1} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" pointerEvents="none">{payload.ticker}</text>
        </g>
    );
};

const ScatterTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
        <div className="bg-white border border-black p-3 text-xs font-mono shadow-lg" style={{ minWidth: 220 }}>
            <div className="font-semibold text-black text-sm mb-1">{p.ticker}</div>
            <div className="text-[#4A4A4A] text-[11px] mb-2 font-sans">{p.name}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div className="text-[#4A4A4A]">Score</div><div className="text-right">{fmtN(p.avg_overall_score)}</div>
                <div className="text-[#4A4A4A]">TAM Score</div><div className="text-right">{fmtN(p.sum_tam_score, 2)}</div>
                <div className="text-[#4A4A4A]">Ratio Compra</div><div className="text-right">{fmtPct(p.ratio_compra_pct)}</div>
                <div className="text-[#4A4A4A]">Ratio Venta</div><div className="text-right">{fmtPct(p.ratio_venta_pct)}</div>
                <div className="text-[#4A4A4A] border-t border-black/10 pt-1 mt-1">Combinado</div><div className="text-right border-t border-black/10 pt-1 mt-1 font-semibold">{(p.combined * 100).toFixed(1)}%</div>
            </div>
        </div>
    );
};

// ---------- Page ----------
export default function Visual() {
    const { user } = useAuth();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(new Set()); // all unchecked by default
    const [sortKey, setSortKey] = useState("combined");
    const [sortDir, setSortDir] = useState("desc");
    const [kpiMean, setKpiMean] = useState(null);
    const [noKpiCount, setNoKpiCount] = useState(0);

    // Filters (only affect map visibility, not the table)
    const [filters, setFilters] = useState({
        score: 0,
        tam: 0,
        rc: -10000,
        rv: -10000,
    });

    // Load on mount (and whenever user changes). All rows start SELECTED so the
    // map shows everything immediately — user uncheck to narrow it down.
    const reload = useCallback(async () => {
        if (!user) { setRows([]); setSelected(new Set()); return; }
        setLoading(true); setError(null);
        try {
            const d = await thesisVisualData();
            const raw = d.rows || [];
            // Media de coef KPI sobre TODAS las empresas que tienen KPI (las demás no cuentan).
            const coefs = raw.map((r) => r.kpi_coef).filter((v) => typeof v === "number");
            const mediaC = coefs.length ? coefs.reduce((a, b) => a + b, 0) / coefs.length : 1;
            const neutro = (1 + mediaC) / 2;
            const enriched = raw.map((r) => {
                const f = kpiFactor(r.kpi_coef, neutro);
                const cq = clamp01(qualBase(r) * f);
                return { ...r, kpi_factor: f, combined_qual: cq, combined: (cq + priceBase(r)) / 2 };
            });
            setRows(enriched);
            setKpiMean(coefs.length ? mediaC : null);
            setNoKpiCount(raw.length - coefs.length);
            setSelected(new Set(enriched.map((r) => r.ticker)));
        } catch (e) {
            setError(e?.response?.data?.detail || e.message);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { reload(); }, [reload]);

    // Live-update dot colours when the user edits the cheap/fair thresholds.
    // ThresholdsDialog dispatches `vs:thresholds-changed`; we bump a tick to force
    // recharts to re-render the Scatter dots (signalFor reads localStorage on demand).
    const [, setThresholdsTick] = useState(0);
    useEffect(() => {
        const onChange = () => setThresholdsTick((n) => n + 1);
        window.addEventListener("vs:thresholds-changed", onChange);
        return () => window.removeEventListener("vs:thresholds-changed", onChange);
    }, []);

    // Sorting (table) — always over ALL rows. String columns (ticker/name) sort
    // alphabetically; the rest numerically.
    const STRING_KEYS = useMemo(() => new Set(["ticker", "name"]), []);
    const sortedRows = useMemo(() => {
        const arr = [...rows];
        const isStr = STRING_KEYS.has(sortKey);
        arr.sort((a, b) => {
            const av = a[sortKey]; const bv = b[sortKey];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (isStr) {
                const c = String(av).localeCompare(String(bv), "es", { sensitivity: "base" });
                return sortDir === "asc" ? c : -c;
            }
            return sortDir === "asc" ? av - bv : bv - av;
        });
        return arr;
    }, [rows, sortKey, sortDir, STRING_KEYS]);

    const onSort = (k) => {
        if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortKey(k); setSortDir(STRING_KEYS.has(k) ? "asc" : "desc"); }
    };

    const allSelected = rows.length > 0 && selected.size === rows.length;
    const toggleAll = () => {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(rows.map((r) => r.ticker)));
    };
    const toggleOne = (tk) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(tk)) next.delete(tk); else next.add(tk);
            return next;
        });
    };

    // Map data: selected + passing filters
    const mapRows = useMemo(() => rows.filter((r) => {
        if (!selected.has(r.ticker)) return false;
        if (r.avg_overall_score == null || r.ratio_compra_pct == null) return false; // need both axes
        if ((r.avg_overall_score || 0) < filters.score) return false;
        if ((r.sum_tam_score || 0) < filters.tam) return false;
        if ((r.ratio_compra_pct || -10000) < filters.rc) return false;
        if ((r.ratio_venta_pct || -10000) < filters.rv) return false;
        return true;
    }), [rows, selected, filters]);

    const resetFilters = () => setFilters({ score: 0, tam: 0, rc: -10000, rv: -10000 });

    // Dynamic quadrant divider: use median of MAP rows so dots end up balanced
    // across the 4 quadrants regardless of dataset spread. Falls back to median
    // of all rows when nothing is selected, then to (50, 0) when no data at all.
    const { medianX, medianY } = useMemo(() => {
        const base = mapRows.length ? mapRows : rows.filter((r) => r.avg_overall_score != null && r.ratio_compra_pct != null);
        if (!base.length) return { medianX: 50, medianY: 0 };
        const median = (arr) => {
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        return {
            medianX: median(base.map((r) => r.avg_overall_score)),
            medianY: median(base.map((r) => r.ratio_compra_pct)),
        };
    }, [mapRows, rows]);

    // Dynamic X-axis domain: start at 60 by default (most quality companies score >60,
    // and 60 is also the threshold above which we consider a thesis "investable"). If
    // any visible company has score <60, extend the axis downward to include it.
    const xDomain = useMemo(() => {
        const base = mapRows.length ? mapRows : rows;
        const scores = base.map((r) => r.avg_overall_score).filter((v) => v != null);
        if (!scores.length) return [60, 100];
        const minScore = Math.min(...scores);
        if (minScore >= 60) return [60, 100];
        return [Math.max(0, Math.floor(minScore / 5) * 5), 100];
    }, [mapRows, rows]);

    if (!user) {
        return (
            <div className="max-w-4xl mx-auto px-6 py-12 text-center">
                <div className="text-xl font-serif text-[#4A4A4A]">Inicia sesión para ver tu Visual.</div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-6 py-8" data-testid="visual-page">
            {/* Header */}
            <div className="flex items-end justify-between mb-6 border-b border-black/20 pb-3">
                <div>
                    <h1 className="font-serif text-4xl text-black tracking-tight">Visual</h1>
                    <div className="text-xs text-[#4A4A4A] mt-1 font-mono">
                        {selected.size} / {rows.length} empresas seleccionadas · {mapRows.length} visibles en el mapa
                    </div>
                </div>
                <button onClick={reload} className="overline text-xs px-3 py-1.5 border border-black hover:bg-black hover:text-white transition" data-testid="visual-refresh">
                    {loading ? <Loader2 size={12} className="inline mr-1 animate-spin" /> : null}Actualizar
                </button>
            </div>

            {error && (
                <div className="border border-[#B32A22] bg-[#FEF2F2] p-3 text-sm text-[#B32A22] mb-4" data-testid="visual-error">
                    Error: {error}
                </div>
            )}

            {/* Quadrant Map */}
            <div className="border border-black/20 p-4 mb-6 bg-white" data-testid="visual-map">
                <div className="overline text-[#4A4A4A] mb-2">Cuadrante calidad ↔ valoración</div>
                <ResponsiveContainer width="100%" height={460}>
                    <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 50 }}>
                        <CartesianGrid stroke="#00000010" />
                        <XAxis type="number" dataKey="avg_overall_score" name="Score" domain={xDomain} tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }} label={{ value: "Score cualitativo →", position: "insideBottom", offset: -10, fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <YAxis type="number" dataKey="ratio_compra_pct" name="Ratio Compra %" tick={{ fontFamily: "IBM Plex Mono", fontSize: 11 }} label={{ value: "Ratio Compra % →", angle: -90, position: "insideLeft", fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <ZAxis dataKey="sum_tam_score" range={[60, 600]} />
                        <Tooltip content={<ScatterTooltip />} />
                        <ReferenceLine x={medianX} stroke="#000" strokeDasharray="3 3" label={{ value: `Score ≈${medianX.toFixed(0)}`, position: "top", fill: "#4A4A4A", fontSize: 10, fontFamily: "IBM Plex Mono" }} />
                        <ReferenceLine y={medianY} stroke="#000" strokeDasharray="3 3" label={{ value: `${medianY >= 0 ? "+" : ""}${medianY.toFixed(0)}%`, position: "right", fill: "#4A4A4A", fontSize: 10, fontFamily: "IBM Plex Mono" }} />
                        <QuadrantLabels />
                        <Scatter data={mapRows} shape={<Dot />} />
                    </ScatterChart>
                </ResponsiveContainer>
                <div className="text-xs text-[#4A4A4A] mt-3 font-sans flex items-center gap-5 flex-wrap leading-relaxed">
                    {(() => {
                        // Read live thresholds via signalFor probe values so the legend
                        // reflects whatever the user has configured in Umbrales.
                        const t = (typeof window !== "undefined" && JSON.parse(window.localStorage.getItem("vs.thresholds.v1") || "null"))?.venta;
                        const cheap = t?.cheap ?? 20;
                        const fair = t?.fair ?? 0;
                        return (
                            <span>📍 Tamaño = TAM Score · Color = Ratio Venta (
                                <span className="text-[#1D7044] font-semibold">verde ≥{cheap}%</span>,{" "}
                                <span className="text-[#B8860B] font-semibold">ámbar {fair}% a {cheap}%</span>,{" "}
                                <span className="text-[#B32A22] font-semibold">rojo &lt;{fair}%</span>
                                ) · configurable en <em>Umbrales</em>
                            </span>
                        );
                    })()}
                    <span>Líneas discontinuas: <span className="font-mono">mediana</span> de las empresas visibles — el cruce divide los 4 cuadrantes dinámicamente.</span>
                </div>
            </div>

            {/* Filters */}
            <div className="border border-black/20 p-4 mb-4 bg-[#FAF6EE]" data-testid="visual-filters">
                <div className="flex items-center justify-between mb-3">
                    <div className="overline text-[#4A4A4A]">Filtros · ocultan empresas del mapa (la tabla muestra siempre todo)</div>
                    <button onClick={resetFilters} className="text-xs font-mono text-[#4A4A4A] hover:text-black flex items-center gap-1" data-testid="visual-reset-filters">
                        <RotateCcw size={12} /> Reset
                    </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <FilterField label="Score min" value={filters.score} step={1} onChange={(v) => setFilters({ ...filters, score: v })} testid="filter-score" />
                    <FilterField label="TAM Score min" value={filters.tam} step={0.5} onChange={(v) => setFilters({ ...filters, tam: v })} testid="filter-tam" />
                    <FilterField label="Ratio Compra ≥ %" value={filters.rc} step={5} onChange={(v) => setFilters({ ...filters, rc: v })} testid="filter-rc" suffix="%" />
                    <FilterField label="Ratio Venta ≥ %" value={filters.rv} step={5} onChange={(v) => setFilters({ ...filters, rv: v })} testid="filter-rv" suffix="%" />
                </div>
            </div>

            {/* Table */}
            <div className="border border-black/20 bg-white overflow-x-auto" data-testid="visual-table">
                <table className="w-full text-sm font-mono">
                    <thead className="bg-black text-white">
                        <tr>
                            <th className="p-2 text-left w-8">
                                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="cursor-pointer" data-testid="visual-toggle-all" />
                            </th>
                            <SortableTh label="Ticker" k="ticker" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" />
                            <SortableTh label="Nombre" k="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="left" className="font-sans" />
                            <SortableTh label="Score" k="avg_overall_score" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.score} />
                            <SortableTh label="TAM Score" k="sum_tam_score" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.tam} />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Coef</span><span>KPI</span></span>} k="kpi_coef" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.kpi} />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Combinado</span><span>cualitativo</span></span>} k="combined_qual" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.combined_qual} />
                            <SortableTh label="Compra %" k="ratio_compra_pct" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.compra} />
                            <SortableTh label="Venta %" k="ratio_venta_pct" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.venta} />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Combinado</span><span>total</span></span>} k="combined" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip={TIP.combined} />
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.length === 0 && !loading && (
                            <tr><td colSpan={10} className="p-6 text-center text-[#4A4A4A] font-sans">No hay empresas miembros de tesis trend. Genera tesis primero.</td></tr>
                        )}
                        {sortedRows.map((r) => {
                            const checked = selected.has(r.ticker);
                            const incomplete = r.ratio_compra_pct == null || r.avg_overall_score == null;
                            return (
                                <tr key={r.ticker} className={`border-t border-black/10 ${incomplete ? "text-[#9ca3af]" : "hover:bg-[#FAF6EE]"}`} data-testid={`visual-row-${r.ticker}`}>
                                    <td className="p-2"><input type="checkbox" checked={checked} onChange={() => toggleOne(r.ticker)} className="cursor-pointer" data-testid={`visual-toggle-${r.ticker}`} /></td>
                                    <td className="p-2 font-semibold"><Link to={`/company/${r.ticker}`} className="hover:underline">{r.ticker}</Link></td>
                                    <td className="p-2 font-sans text-xs">{r.name}</td>
                                    <td className="p-2 text-right">{fmtN(r.avg_overall_score)}</td>
                                    <td className="p-2 text-right">{fmtN(r.sum_tam_score, 2)}</td>
                                    <td className="p-2 text-right" data-testid={`visual-kpi-${r.ticker}`}>
                                        {typeof r.kpi_coef === "number"
                                            ? <span style={{ color: coefColor(r.kpi_coef) }} className="font-semibold">{r.kpi_coef.toFixed(2)}</span>
                                            : <span className="text-[#9ca3af]">—</span>}
                                    </td>
                                    <td className="p-2 text-right">{(r.combined_qual * 100).toFixed(1)}%</td>
                                    <td className="p-2 text-right" style={{ color: signalFor(r.ratio_compra_pct, "compra").color }}>{fmtPct(r.ratio_compra_pct)}</td>
                                    <td className="p-2 text-right" style={{ color: signalFor(r.ratio_venta_pct, "venta").color }}>{fmtPct(r.ratio_venta_pct)}</td>
                                    <td className="p-2 text-right font-semibold">{(r.combined * 100).toFixed(1)}%</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* KPI notice */}
            <div className="text-xs text-[#4A4A4A] mt-3 font-sans leading-relaxed" data-testid="visual-kpi-note">
                {kpiMean != null && (
                    <span>El <strong>coef KPI</strong> modula los combinados respecto a la media del universo (<span className="font-mono">{kpiMean.toFixed(2)}</span>): por encima del punto neutro mejora el porcentaje, por debajo lo empeora (cuenta una sola vez). </span>
                )}
                {noKpiCount > 0 && (
                    <span data-testid="visual-no-kpi-note">
                        {noKpiCount === 1 ? "1 empresa aún no tiene" : `${noKpiCount} empresas aún no tienen`} coeficiente KPI («—»): no se incluye este factor en {noKpiCount === 1 ? "su combinado" : "sus combinados"}. Analíza{noKpiCount === 1 ? "la" : "las"} en <Link to="/kpis" className="underline hover:text-black">/kpis</Link>.
                    </span>
                )}
            </div>
        </div>
    );
}

// ---------- Small subcomponents ----------
const FilterField = ({ label, value, step, onChange, testid, suffix }) => (
    <label className="block">
        <div className="text-[11px] text-[#4A4A4A] font-mono mb-1">{label}</div>
        <div className="flex items-center">
            <input
                type="number"
                value={value}
                step={step}
                onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                className="border border-black px-2 py-1 text-sm font-mono w-full"
                data-testid={testid}
            />
            {suffix && <span className="ml-1 text-xs text-[#4A4A4A] font-mono">{suffix}</span>}
        </div>
    </label>
);

const SortableTh = ({ label, k, sortKey, sortDir, onSort, tip, align = "right", className = "" }) => {
    const active = sortKey === k;
    const inner = (
        <span className="inline-flex items-center gap-1">
            {label}
            {active ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null}
        </span>
    );
    return (
        <th className={`p-2 cursor-pointer select-none ${align === "left" ? "text-left" : "text-right"} ${className}`} onClick={() => onSort(k)} data-testid={`sort-${k}`}>
            {tip ? <HoverTip text={tip} maxWidth={300}><span className="cursor-help">{inner}</span></HoverTip> : inner}
        </th>
    );
};
