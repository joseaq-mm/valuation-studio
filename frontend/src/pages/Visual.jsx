import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ZAxis } from "recharts";
import { Loader2, RotateCcw, ArrowUp, ArrowDown, Bell, BellRing } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisVisualData, alertsGet, alertSave, alertDelete } from "@/lib/api";
import HoverTip from "@/components/HoverTip";
import { FreshnessBadge } from "@/components/FreshnessBadge";
import { signalFor } from "@/lib/thresholds";
import { toast } from "sonner";

// ---------- Helpers ----------
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Next-earnings date badge. Red/bold when the report is due in ≤7 days; muted when the
// estimated date has already passed; "≈" prefix marks a tentative (estimated) date.
function EarningsBadge({ date, estimated, testid }) {
    if (!date) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const d = new Date(date);
    if (isNaN(d.getTime())) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    const sameYear = d.getUTCFullYear() === new Date().getFullYear();
    const label = `${estimated ? "≈" : ""}${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}${sameYear ? "" : " '" + String(d.getUTCFullYear()).slice(2)}`;
    const imminent = days >= 0 && days <= 7;
    // "Próximos resultados" is by definition a future date → only normal or bold (≤7d).
    const weight = imminent ? 700 : 400;
    const tip = days < 0
        ? `Fecha de resultados pendiente de actualizar por Yahoo (${label}).`
        : imminent
            ? `¡Resultados ${days === 0 ? "hoy" : "en " + days + " día" + (days === 1 ? "" : "s")}! (${label})${estimated ? " · fecha estimada" : ""}`
            : `Próximos resultados${estimated ? " (estimado)" : ""}: faltan ${days} días (${label}).`;
    return (
        <HoverTip text={tip}>
            <span className="font-mono tabular-nums cursor-help whitespace-nowrap" style={{ color: "#111111", fontWeight: weight }} data-testid={testid}>
                {label}
            </span>
        </HoverTip>
    );
}

// Last published earnings date. Plain/muted (a past reference date, never colour-coded).
function LastEarningsBadge({ date, testid }) {
    if (!date) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const d = new Date(date);
    if (isNaN(d.getTime())) return <span className="text-[#9A9A9A]" data-testid={testid}>—</span>;
    const sameYear = d.getUTCFullYear() === new Date().getFullYear();
    const label = `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}${sameYear ? "" : " '" + String(d.getUTCFullYear()).slice(2)}`;
    return (
        <HoverTip text={`Últimos resultados publicados: ${label}.`}>
            <span className="font-mono tabular-nums cursor-help whitespace-nowrap text-[#4A4A4A]" data-testid={testid}>
                {label}
            </span>
        </HoverTip>
    );
}

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

/** Aguja KPI: dirección por matriz 2×2 (absoluto C↔1 = izq/dcha; relativo C↔media = arriba/abajo),
 *  inclinación 0°→45° y fuerza ∝ |C − media| normalizada (REF = mayor desviación relativa del universo). */
const kpiArrow = (C, media, REF) => {
    if (C == null || typeof C !== "number") return null;
    const rdev = C - media;   // relativo  → arriba (≥0) / abajo (<0)
    const adev = C - 1;       // absoluto  → derecha (≥0) / izquierda (<0)
    const side = adev >= 0 ? 1 : -1;
    const vert = rdev >= 0 ? 1 : -1;
    const strength = REF > 0 ? clamp(Math.abs(rdev) / REF, 0, 1) : 0;
    let color;
    if (adev >= 0 && rdev >= 0) color = "#1D7044";      // verde · arriba-dcha
    else if (adev >= 0 && rdev < 0) color = "#B8860B";  // ámbar · abajo-dcha
    else if (adev < 0 && rdev >= 0) color = "#B8860B";  // ámbar · arriba-izq
    else color = "#B32A22";                              // rojo  · abajo-izq
    return { side, vert, strength, color };
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

const DEG = Math.PI / 180;
// KPI needle: radial arrow emerging from the dot's edge. Angle measured from the
// center; tilt (0–45°) + length scale with relative strength. Direction & colour
// follow the 2×2 matrix (absolute C↔1 = left/right, relative C↔mean = up/down).
const KpiNeedle = ({ cx, cy, r, arrow }) => {
    const tilt = 45 * arrow.strength * DEG;
    const dirX = arrow.side * Math.cos(tilt);
    const dirY = -arrow.vert * Math.sin(tilt); // screen y is inverted (up = negative)
    const len = 11 + 30 * arrow.strength;
    const x0 = cx + r * dirX, y0 = cy + r * dirY;
    const x1 = cx + (r + len) * dirX, y1 = cy + (r + len) * dirY;
    const ang = Math.atan2(dirY, dirX);
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const px = -uy, py = ux;
    const h = 7, w = 4;
    const bx = x1 - h * ux, by = y1 - h * uy;
    return (
        <g pointerEvents="none">
            <line x1={x0} y1={y0} x2={bx} y2={by} stroke={arrow.color} strokeWidth={2.6} strokeLinecap="round" />
            <polygon points={`${x1},${y1} ${bx + w * px},${by + w * py} ${bx - w * px},${by - w * py}`} fill={arrow.color} stroke="#000" strokeWidth={0.5} />
        </g>
    );
};

const Dot = (props) => {
    const { cx, cy, payload } = props;
    const r = Math.max(5, Math.min(22, 4 + Math.sqrt(Math.max(0, payload.sum_tam_score || 0)) * 2.2));
    return (
        <g>
            <circle cx={cx} cy={cy} r={r} fill={colorForRv(payload.ratio_venta_pct)} fillOpacity={0.75} stroke="#000" strokeWidth={1} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" pointerEvents="none">{payload.ticker}</text>
            {payload.kpi_arrow && <KpiNeedle cx={cx} cy={cy} r={r} arrow={payload.kpi_arrow} />}
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
                {typeof p.kpi_coef === "number" && (<>
                    <div className="text-[#4A4A4A]">Coef KPI</div><div className="text-right" style={{ color: coefColor(p.kpi_coef) }}>{p.kpi_coef.toFixed(2)}</div>
                </>)}
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
    const [alerts, setAlerts] = useState({});  // ticker -> alert config

    useEffect(() => {
        if (!user) { setAlerts({}); return; }
        alertsGet().then((d) => setAlerts(d.alerts || {})).catch(() => { });
    }, [user]);

    const onAlertSaved = useCallback((ticker, alert) => {
        setAlerts((prev) => {
            const next = { ...prev };
            if (alert) next[ticker] = alert; else delete next[ticker];
            return next;
        });
    }, []);

    // Filters (only affect map visibility, not the table)
    const [filters, setFilters] = useState({
        score: 0,
        tam: 0,
        kpi: -10000,
        rc: -10000,
        rv: -10000,
        cqual: 0,
        ctotal: 0,
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
            const REF = coefs.length ? Math.max(...coefs.map((c) => Math.abs(c - mediaC))) : 0;
            const enriched = raw.map((r) => {
                const f = kpiFactor(r.kpi_coef, neutro);
                const cq = clamp01(qualBase(r) * f);
                return { ...r, kpi_factor: f, kpi_arrow: kpiArrow(r.kpi_coef, mediaC, REF), combined_qual: cq, combined: (cq + priceBase(r)) / 2 };
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

    // A row passes the numeric filters (drives both map visibility and table marking).
    const passesFilters = useCallback((r, f) => (
        (r.avg_overall_score || 0) >= f.score &&
        (r.sum_tam_score || 0) >= f.tam &&
        (typeof r.kpi_coef === "number" ? r.kpi_coef : -10000) >= f.kpi &&
        (r.ratio_compra_pct ?? -10000) >= f.rc &&
        (r.ratio_venta_pct ?? -10000) >= f.rv &&
        ((r.combined_qual ?? 0) * 100) >= f.cqual &&
        ((r.combined ?? 0) * 100) >= f.ctotal
    ), []);

    // Keep the table checkboxes in sync with the filters: selecting/adjusting a filter
    // automatically marks (passes) or unmarks (fails) each row.
    useEffect(() => {
        if (!rows.length) return;
        setSelected(new Set(rows.filter((r) => passesFilters(r, filters)).map((r) => r.ticker)));
    }, [filters, rows, passesFilters]);

    // Sorting (table) — always over ALL rows. String columns (ticker/name) sort
    // alphabetically; the rest numerically.
    const STRING_KEYS = useMemo(() => new Set(["ticker", "name"]), []);
    const DATE_KEYS = useMemo(() => new Set(["thesis_updated_at", "next_earnings_date", "last_earnings_date"]), []);
    const sortedRows = useMemo(() => {
        const arr = [...rows];
        const isStr = STRING_KEYS.has(sortKey);
        const isDate = DATE_KEYS.has(sortKey);
        arr.sort((a, b) => {
            const av = a[sortKey]; const bv = b[sortKey];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (isStr) {
                const c = String(av).localeCompare(String(bv), "es", { sensitivity: "base" });
                return sortDir === "asc" ? c : -c;
            }
            if (isDate) {
                const at = Date.parse(av); const bt = Date.parse(bv);
                return sortDir === "asc" ? at - bt : bt - at;
            }
            return sortDir === "asc" ? av - bv : bv - av;
        });
        return arr;
    }, [rows, sortKey, sortDir, STRING_KEYS, DATE_KEYS]);

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

    // Map data: selected rows that also pass the filters (need both axes to plot).
    const mapRows = useMemo(() => rows.filter((r) => {
        if (!selected.has(r.ticker)) return false;
        if (r.avg_overall_score == null || r.ratio_compra_pct == null) return false; // need both axes
        return passesFilters(r, filters);
    }), [rows, selected, filters, passesFilters]);

    const resetFilters = () => setFilters({ score: 0, tam: 0, kpi: -10000, rc: -10000, rv: -10000, cqual: 0, ctotal: 0 });

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
                    <span className="basis-full">➤ <strong>Aguja KPI</strong>: dirección = validación operativa (dcha si C&gt;1, izq si C&lt;1; arriba si C&gt;media, abajo si C&lt;media). Longitud/inclinación ∝ fuerza relativa. <span className="text-[#1D7044] font-semibold">verde</span> = valida (arriba-dcha), <span className="text-[#B8860B] font-semibold">ámbar</span> = mixto, <span className="text-[#B32A22] font-semibold">rojo</span> = refuta (abajo-izq). Sin aguja = sin KPI.</span>
                </div>
            </div>

            {/* Filters */}
            <div className="border border-black/20 p-4 mb-4 bg-[#FAF6EE]" data-testid="visual-filters">
                <div className="flex items-center justify-between mb-3">
                    <div className="overline text-[#4A4A4A]">Filtros · marcan/desmarcan empresas en la tabla y las muestran u ocultan en el mapa</div>
                    <button onClick={resetFilters} className="text-xs font-mono text-[#4A4A4A] hover:text-black flex items-center gap-1" data-testid="visual-reset-filters">
                        <RotateCcw size={12} /> Reset
                    </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <FilterField label="Score min" value={filters.score} step={1} onChange={(v) => setFilters({ ...filters, score: v })} testid="filter-score" />
                    <FilterField label="TAM Score min" value={filters.tam} step={0.5} onChange={(v) => setFilters({ ...filters, tam: v })} testid="filter-tam" />
                    <FilterField label="Coef KPI ≥" value={filters.kpi} step={0.1} onChange={(v) => setFilters({ ...filters, kpi: v })} testid="filter-kpi" />
                    <FilterField label="Ratio Compra ≥ %" value={filters.rc} step={5} onChange={(v) => setFilters({ ...filters, rc: v })} testid="filter-rc" suffix="%" />
                    <FilterField label="Ratio Venta ≥ %" value={filters.rv} step={5} onChange={(v) => setFilters({ ...filters, rv: v })} testid="filter-rv" suffix="%" />
                    <FilterField label="Combinado cual. ≥ %" value={filters.cqual} step={5} onChange={(v) => setFilters({ ...filters, cqual: v })} testid="filter-cqual" suffix="%" />
                    <FilterField label="Combinado total ≥ %" value={filters.ctotal} step={5} onChange={(v) => setFilters({ ...filters, ctotal: v })} testid="filter-ctotal" suffix="%" />
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
                            <SortableTh label="Tesis" k="thesis_updated_at" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip="Días desde la última actualización de la tesis. En rojo si la empresa ha publicado resultados posteriores a esa fecha (conviene reanalizar)." />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Ant.</span><span>result.</span></span>} k="last_earnings_date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip="Fecha de los últimos resultados publicados (Yahoo Finance)." />
                            <SortableTh label={<span className="flex flex-col leading-tight items-end"><span>Próx.</span><span>result.</span></span>} k="next_earnings_date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} tip="Fecha estimada de los próximos resultados (Yahoo Finance). En rojo si faltan 7 días o menos. El símbolo ≈ indica que la fecha es tentativa." />
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
                            <tr><td colSpan={13} className="p-6 text-center text-[#4A4A4A] font-sans">No hay empresas miembros de tesis trend. Genera tesis primero.</td></tr>
                        )}
                        {sortedRows.map((r) => {
                            const checked = selected.has(r.ticker);
                            const incomplete = r.ratio_compra_pct == null || r.avg_overall_score == null;
                            return (
                                <tr key={r.ticker} className={`border-t border-black/10 ${incomplete ? "text-[#9ca3af]" : "hover:bg-[#FAF6EE]"}`} data-testid={`visual-row-${r.ticker}`}>
                                    <td className="p-2"><input type="checkbox" checked={checked} onChange={() => toggleOne(r.ticker)} className="cursor-pointer" data-testid={`visual-toggle-${r.ticker}`} /></td>
                                    <td className="p-2 font-semibold"><Link to={`/company/${r.ticker}`} className="hover:underline">{r.ticker}</Link></td>
                                    <td className="p-2 font-sans text-xs"><span className="inline-flex items-center gap-1.5"><span>{r.name}</span><AlertBell ticker={r.ticker} alert={alerts[r.ticker]} onSaved={onAlertSaved} /></span></td>
                                    <td className="p-2 text-right"><FreshnessBadge updatedAt={r.thesis_updated_at} lastEarningsDate={r.last_earnings_date} nextEarningsDate={r.next_earnings_date} noun="la última actualización de la tesis" testid={`visual-fresh-${r.ticker}`} /></td>
                                    <td className="p-2 text-right"><LastEarningsBadge date={r.last_earnings_date} testid={`visual-last-earnings-${r.ticker}`} /></td>
                                    <td className="p-2 text-right"><EarningsBadge date={r.next_earnings_date} estimated={r.next_earnings_estimated} testid={`visual-earnings-${r.ticker}`} /></td>
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
const AlertBell = ({ ticker, alert, onSaved }) => {
    const initFrom = (a) => ({
        score: { enabled: a?.score?.enabled || false, dir: a?.score?.dir || "gte", value: a?.score?.value ?? "" },
        tam: { enabled: a?.tam?.enabled || false, dir: a?.tam?.dir || "gte", value: a?.tam?.value ?? "" },
        kpi: { enabled: a?.kpi?.enabled || false, dir: a?.kpi?.dir || "gte", value: a?.kpi?.value ?? "" },
    });
    const active = !!alert;
    const btnRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const [form, setForm] = useState(initFrom(alert));
    const [saving, setSaving] = useState(false);
    useEffect(() => { setForm(initFrom(alert)); }, [alert]);  // eslint-disable-line react-hooks/exhaustive-deps

    const openPanel = () => {
        const r = btnRef.current?.getBoundingClientRect();
        if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 280)) });
        setOpen((o) => !o);
    };
    const setMetric = (k, patch) => setForm((f) => ({ ...f, [k]: { ...f[k], ...patch } }));

    const save = async () => {
        setSaving(true);
        try {
            const payload = {};
            for (const k of ["score", "tam", "kpi"]) {
                const m = form[k];
                payload[k] = { enabled: !!m.enabled, dir: m.dir, value: m.value === "" ? null : parseFloat(m.value) };
            }
            const res = await alertSave(ticker, payload);
            onSaved(ticker, res.alert || null);
            toast.success(res.removed ? `Alerta de ${ticker} eliminada` : `Alerta de ${ticker} guardada`);
            setOpen(false);
        } catch { toast.error("No se pudo guardar la alerta"); }
        finally { setSaving(false); }
    };
    const remove = async () => {
        setSaving(true);
        try { await alertDelete(ticker); onSaved(ticker, null); toast.success(`Alerta de ${ticker} eliminada`); setOpen(false); }
        catch { toast.error("No se pudo eliminar"); }
        finally { setSaving(false); }
    };

    return (
        <>
            <button ref={btnRef} onClick={openPanel} className={active ? "text-[#B8860B]" : "text-[#B0B0B0] hover:text-[#052049]"} title={active ? "Alerta configurada — clic para editar" : "Configurar alerta de seguimiento"} data-testid={`alert-bell-${ticker}`}>
                {active ? <BellRing size={15} /> : <Bell size={15} />}
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="fixed z-50 w-64 bg-white border-2 border-[#052049] shadow-xl p-3 text-left font-sans" style={{ top: pos.top, left: pos.left }} data-testid={`alert-panel-${ticker}`}>
                        <div className="text-xs font-semibold text-[#052049] mb-2">Alerta · {ticker}</div>
                        {[["score", "Score"], ["tam", "TAM Score"], ["kpi", "Coef KPI"]].map(([k, label]) => (
                            <div key={k} className="mb-2 border-b border-black/5 pb-2">
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                    <input type="checkbox" checked={form[k].enabled} onChange={(e) => setMetric(k, { enabled: e.target.checked })} data-testid={`alert-${k}-enabled-${ticker}`} />
                                    <span className="font-medium">{label}</span>
                                </label>
                                {form[k].enabled && (
                                    <div className="flex items-center gap-1 mt-1.5 pl-5">
                                        <select value={form[k].dir} onChange={(e) => setMetric(k, { dir: e.target.value })} className="border border-black/30 text-xs px-1 py-0.5" data-testid={`alert-${k}-dir-${ticker}`}>
                                            <option value="gte">≥</option>
                                            <option value="lte">≤</option>
                                        </select>
                                        <input type="number" step="0.1" value={form[k].value} onChange={(e) => setMetric(k, { value: e.target.value })} placeholder="valor" className="border border-black/30 text-xs px-1.5 py-0.5 w-full font-mono" data-testid={`alert-${k}-value-${ticker}`} />
                                    </div>
                                )}
                            </div>
                        ))}
                        <div className="text-[10px] text-[#7A7A7A] mb-2">Además te avisaré si cruza de barato↔caro. Todo en un único email diario.</div>
                        <div className="flex gap-2">
                            <button onClick={save} disabled={saving} className="flex-1 bg-[#052049] text-white text-xs py-1.5 font-semibold disabled:opacity-50" data-testid={`alert-save-${ticker}`}>Guardar</button>
                            {active && <button onClick={remove} disabled={saving} className="px-2 border border-[#B32A22] text-[#B32A22] text-xs py-1.5" data-testid={`alert-remove-${ticker}`}>Quitar</button>}
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

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
