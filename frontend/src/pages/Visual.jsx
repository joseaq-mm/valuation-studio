import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis } from "recharts";
import { Loader2, RotateCcw, ArrowUp, ArrowDown } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisVisualData } from "@/lib/api";

// ---------- Helpers ----------
const clamp01 = (v) => (v == null ? 0 : Math.max(0, Math.min(1, v)));

/** Combined ranking — media simple normalizada de las 4 variables. Null → 0.
 *  Score: /100        TAM: /30 capped     Compra/Venta: clamp((v+50)/150)  */
const computeCombined = (r) => {
    const s = clamp01((r.avg_overall_score || 0) / 100);
    const t = clamp01((r.sum_tam_score || 0) / 30);
    const rc = clamp01(((r.ratio_compra_pct ?? -50) + 50) / 150);
    const rv = clamp01(((r.ratio_venta_pct ?? -50) + 50) / 150);
    return (s + t + rc + rv) / 4;
};

const fmtPct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const fmtN = (v, d = 1) => (v == null ? "—" : v.toFixed(d));

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
const colorForRv = (rv) => {
    if (rv == null) return "#9ca3af";
    if (rv >= 20) return "#1D7044";   // green: strong upside
    if (rv >= 0)  return "#B8860B";   // amber: modest
    return "#B32A22";                 // red: negative
};

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

    // Filters (only affect map visibility, not the table)
    const [filters, setFilters] = useState({
        score: 0,
        tam: 0,
        rc: -10000,
        rv: -10000,
    });

    // Load on mount (and whenever user changes).
    const reload = useCallback(async () => {
        if (!user) { setRows([]); return; }
        setLoading(true); setError(null);
        try {
            const d = await thesisVisualData();
            const enriched = (d.rows || []).map((r) => ({ ...r, combined: computeCombined(r) }));
            setRows(enriched);
        } catch (e) {
            setError(e?.response?.data?.detail || e.message);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => { reload(); }, [reload]);

    // Sorting (table) — always over ALL rows
    const sortedRows = useMemo(() => {
        const arr = [...rows];
        arr.sort((a, b) => {
            const av = a[sortKey]; const bv = b[sortKey];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return sortDir === "asc" ? av - bv : bv - av;
        });
        return arr;
    }, [rows, sortKey, sortDir]);

    const onSort = (k) => {
        if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        else { setSortKey(k); setSortDir("desc"); }
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

    // Dynamic X-axis domain: start at 50 by default (since most quality companies
    // score >50, this avoids huge dead zone on the left). If any visible company
    // has score < 50, extend the axis downward to include it (rounded to nearest 5).
    const xDomain = useMemo(() => {
        const base = mapRows.length ? mapRows : rows;
        const scores = base.map((r) => r.avg_overall_score).filter((v) => v != null);
        if (!scores.length) return [50, 100];
        const minScore = Math.min(...scores);
        if (minScore >= 50) return [50, 100];
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
                    <span>📍 Tamaño = TAM Score · Color = Ratio Venta (<span className="text-[#1D7044] font-semibold">verde ≥20%</span>, <span className="text-[#B8860B] font-semibold">ámbar 0-20%</span>, <span className="text-[#B32A22] font-semibold">rojo &lt;0%</span>)</span>
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
                            <th className="p-2 text-left">Ticker</th>
                            <th className="p-2 text-left font-sans">Nombre</th>
                            <SortableTh label="Score" k="avg_overall_score" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                            <SortableTh label="TAM Score" k="sum_tam_score" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                            <SortableTh label="Compra %" k="ratio_compra_pct" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                            <SortableTh label="Venta %" k="ratio_venta_pct" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                            <SortableTh label="Combinado" k="combined" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.length === 0 && !loading && (
                            <tr><td colSpan={8} className="p-6 text-center text-[#4A4A4A] font-sans">No hay empresas miembros de tesis trend. Genera tesis primero.</td></tr>
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
                                    <td className={`p-2 text-right ${r.ratio_compra_pct > 0 ? "text-[#1D7044]" : r.ratio_compra_pct < 0 ? "text-[#B32A22]" : ""}`}>{fmtPct(r.ratio_compra_pct)}</td>
                                    <td className={`p-2 text-right ${r.ratio_venta_pct > 0 ? "text-[#1D7044]" : r.ratio_venta_pct < 0 ? "text-[#B32A22]" : ""}`}>{fmtPct(r.ratio_venta_pct)}</td>
                                    <td className="p-2 text-right font-semibold">{(r.combined * 100).toFixed(1)}%</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
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

const SortableTh = ({ label, k, sortKey, sortDir, onSort }) => {
    const active = sortKey === k;
    return (
        <th className="p-2 text-right cursor-pointer select-none" onClick={() => onSort(k)} data-testid={`sort-${k}`}>
            <span className="inline-flex items-center gap-1">
                {label}
                {active ? (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null}
            </span>
        </th>
    );
};
