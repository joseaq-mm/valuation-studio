import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { getCompany, recalc } from "@/lib/api";
import { fmtNum, fmtPct, fmtPrice, fmtPctSigned, fmtInputDisplay, parseLocaleNumber, ratioColor, signalLabel } from "@/lib/format";
import { addToWatchlist, removeFromWatchlist, isInWatchlist } from "@/lib/storage";
import { Star, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

const ratioRows = [
    ["Trailing P/E", "trailing_pe"],
    ["Forward P/E", "forward_pe"],
    ["PEG Ratio", "peg_ratio"],
    ["P/B", "price_to_book"],
    ["P/S", "price_to_sales"],
    ["EV/EBITDA", "ev_to_ebitda"],
    ["EV/Revenue", "ev_to_revenue"],
    ["ROE", "roe", "pct"],
    ["ROA", "roa", "pct"],
    ["Profit margin", "profit_margin", "pct"],
    ["Debt/Equity", "debt_to_equity"],
    ["Current ratio", "current_ratio"],
    ["Dividend yield", "dividend_yield", "pct"],
    ["Beta", "beta"],
    ["Analyst target", "target_mean_price"],
];

export default function Company() {
    const { ticker } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [inWl, setInWl] = useState(false);

    // editable inputs
    const [inputs, setInputs] = useState(null);
    const [customRatios, setCustomRatios] = useState(null);
    const [edited, setEdited] = useState(false);

    const load = useCallback(async (refresh = false) => {
        try {
            setLoading(true); setError(null);
            const d = await getCompany(ticker, refresh);
            setData(d);
            setInputs({
                revenue_2y: d.auto_projections.revenue_2y,
                fcf_2y: d.auto_projections.fcf_2y,
                shares_outstanding: d.shares_outstanding,
                gross_margin: d.gross_margin,
                operating_margin: d.operating_margin,
                net_debt: d.net_debt,
                market_cap: d.market_cap,
                revenue_cagr_4y: d.auto_projections.revenue_cagr_4y,
                fcf_cagr_4y: d.auto_projections.fcf_cagr_4y,
                current_price: d.current_price,
            });
            setCustomRatios(d.custom_ratios);
            setEdited(false);
        } catch (e) {
            setError(e?.response?.data?.detail || e.message || "Error al cargar");
        } finally { setLoading(false); }
    }, [ticker]);

    useEffect(() => { load(); setInWl(isInWatchlist(ticker)); }, [load, ticker]);

    const handleRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); toast.success("Datos actualizados"); };

    const handleWl = () => {
        if (inWl) { removeFromWatchlist(ticker); setInWl(false); toast("Quitada de watchlist"); }
        else { addToWatchlist(ticker); setInWl(true); toast.success("Añadida a watchlist"); }
    };

    const updateInput = (key, val) => {
        const num = parseLocaleNumber(val);
        setInputs({ ...inputs, [key]: num });
        setEdited(true);
    };

    const handleRecalc = async () => {
        try {
            const r = await recalc(ticker, inputs);
            setCustomRatios(r);
            toast.success("Ratios recalculados");
        } catch (e) { toast.error("Error al recalcular"); }
    };

    const handleReset = () => {
        if (!data) return;
        setInputs({
            revenue_2y: data.auto_projections.revenue_2y,
            fcf_2y: data.auto_projections.fcf_2y,
            shares_outstanding: data.shares_outstanding,
            gross_margin: data.gross_margin,
            operating_margin: data.operating_margin,
            net_debt: data.net_debt,
            market_cap: data.market_cap,
            revenue_cagr_4y: data.auto_projections.revenue_cagr_4y,
            fcf_cagr_4y: data.auto_projections.fcf_cagr_4y,
            current_price: data.current_price,
        });
        setCustomRatios(data.custom_ratios);
        setEdited(false);
    };

    if (loading) return <div className="py-20 text-center font-mono" data-testid="loading">Cargando {ticker}…</div>;
    if (error) return (
        <div className="border border-[#B32A22] bg-white p-8" data-testid="error-state">
            <AlertCircle className="text-[#B32A22] mb-2" />
            <div className="font-serif text-2xl mb-2">No se pudo cargar {ticker}</div>
            <div className="text-sm text-[#4A4A4A] mb-4">{error}</div>
            <Link to="/" className="btn-ghost">← Volver al inicio</Link>
        </div>
    );
    if (!data) return null;

    const cr = customRatios || {};
    const cur = data.currency || "USD";

    // Determine if user has edited the 2y projection vs the auto value (small epsilon to avoid float jitter)
    const isEdited = (a, b) => {
        if (a == null || b == null) return false;
        if (a === 0 && b === 0) return false;
        const diff = Math.abs(a - b);
        const scale = Math.max(Math.abs(a), Math.abs(b), 1);
        return diff / scale > 0.001;
    };
    const revEdited = isEdited(inputs?.revenue_2y, data.auto_projections.revenue_2y);
    const fcfEdited = isEdited(inputs?.fcf_2y, data.auto_projections.fcf_2y);

    // Geometric midpoint (smooth compound growth) for the intermediate year.
    // Falls back to linear midpoint if either value is non-positive.
    const interpolate = (a, b) => {
        if (a == null || b == null) return null;
        if (a > 0 && b > 0) return Math.sqrt(a * b);
        return (a + b) / 2;
    };

    const buildChartData = (history, proj1Auto, proj2Auto, userProj2, userEdited, bridge = true) => {
        if (!history || history.length === 0) return [];
        const out = history.map(p => ({
            year: p.date.slice(0, 4),
            historical: p.value / 1e9,
            projection: null,
            kind: "real",
            value: p.value / 1e9,
        }));
        const last = out[out.length - 1];
        if (bridge) last.projection = last.historical;
        const lastYear = parseInt(last.year, 10) || new Date().getFullYear();
        const lastVal = last.historical;

        // Use user value when edited; otherwise the auto projection.
        const proj2 = userEdited ? userProj2 : proj2Auto;
        // For +1y: if user edited the +2y, interpolate between last real and user proj2 to avoid a visual jump.
        // Otherwise use the model's auto +1y projection.
        const proj1 = userEdited
            ? (lastVal != null && proj2 != null ? interpolate(lastVal, proj2 / 1e9) : null)
            : (proj1Auto != null ? proj1Auto / 1e9 : null);

        if (proj1 != null && !isNaN(proj1)) {
            out.push({ year: String(lastYear + 1) + "E", historical: null, projection: proj1, kind: "proj", value: proj1 });
        }
        if (proj2 != null && !isNaN(proj2)) {
            const v = userEdited ? proj2 / 1e9 : proj2 / 1e9;
            out.push({ year: String(lastYear + 2) + "E", historical: null, projection: v, kind: "proj", value: v });
        }
        return out;
    };

    const revChart = buildChartData(data.revenue_history, data.auto_projections.revenue_1y, data.auto_projections.revenue_2y, inputs?.revenue_2y, revEdited, true);
    const fcfChart = buildChartData(data.fcf_history, data.auto_projections.fcf_1y, data.auto_projections.fcf_2y, inputs?.fcf_2y, fcfEdited, false);

    return (
        <div data-testid="company-page">
            {/* Header */}
            <div className="border border-black bg-white p-6 mb-6" data-testid="company-header">
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <div className="overline text-[#4A4A4A]">{data.exchange} · {data.currency}{data.sector ? ` · ${data.sector}` : ""}</div>
                        <h1 className="font-serif text-4xl sm:text-5xl tracking-tight mt-1" data-testid="company-name">{data.name}</h1>
                        <div className="font-mono text-lg text-[#052049] mt-1" data-testid="company-ticker">{data.ticker}</div>
                    </div>
                    <div className="text-right">
                        <div className="overline text-[#4A4A4A]">Precio actual</div>
                        <div className="font-mono text-4xl sm:text-5xl font-medium" data-testid="company-price">{fmtPrice(data.current_price, cur)}</div>
                        <div className="text-xs text-[#4A4A4A] font-mono mt-1">MCap {fmtNum(data.market_cap)}</div>
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <button onClick={handleWl} className="btn-ghost flex items-center gap-2" data-testid="watchlist-toggle">
                        <Star size={14} fill={inWl ? "#111" : "none"} /> {inWl ? "En watchlist" : "Añadir a watchlist"}
                    </button>
                    <button onClick={handleRefresh} className="btn-ghost flex items-center gap-2" data-testid="refresh-button" disabled={refreshing}>
                        <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refrescar
                    </button>
                </div>
                {data.long_business_summary && (
                    <p className="text-sm text-[#4A4A4A] mt-4 max-w-3xl">{data.long_business_summary}</p>
                )}
            </div>

            {/* Hero KPIs - Ratio Compra & Venta */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border border-black mb-6" data-testid="hero-kpis">
                <div className="bg-white p-6 md:border-r border-black border-b md:border-b-0" data-testid="ratio-compra-card">
                    <div className="overline text-[#4A4A4A]">Ratio de Compra</div>
                    <div className="font-mono text-5xl sm:text-6xl font-medium mt-2" style={{ color: ratioColor(cr.ratio_compra_pct) }} data-testid="ratio-compra-value">
                        {fmtPctSigned(cr.ratio_compra_pct)}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                        <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(cr.ratio_compra_pct) }} data-testid="signal-compra">{signalLabel(cr.ratio_compra_pct)}</span>
                        <span className="text-xs text-[#4A4A4A] font-mono">POC {cr.poc != null ? fmtPrice(cr.poc, cur) : "—"}</span>
                    </div>
                    <div className="text-xs text-[#4A4A4A] mt-3">Upside hasta el precio objetivo de compra.</div>
                </div>
                <div className="bg-white p-6" data-testid="ratio-venta-card">
                    <div className="overline text-[#4A4A4A]">Ratio de Venta</div>
                    <div className="font-mono text-5xl sm:text-6xl font-medium mt-2" style={{ color: ratioColor(cr.ratio_venta_pct) }} data-testid="ratio-venta-value">
                        {fmtPctSigned(cr.ratio_venta_pct)}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                        <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(cr.ratio_venta_pct) }} data-testid="signal-venta">{signalLabel(cr.ratio_venta_pct)}</span>
                        <span className="text-xs text-[#4A4A4A] font-mono">POV {cr.pov != null ? fmtPrice(cr.pov, cur) : "—"}</span>
                    </div>
                    <div className="text-xs text-[#4A4A4A] mt-3">Upside hasta el precio objetivo de venta.</div>
                </div>
            </div>

            {cr.missing_inputs && cr.missing_inputs.length > 0 && (
                <div className="border border-[#D97706] bg-white p-3 mb-6 text-xs font-mono flex items-center gap-2" data-testid="missing-inputs-warning">
                    <AlertCircle size={14} className="text-[#D97706]" />
                    Faltan datos para calcular: {cr.missing_inputs.join(", ")}. Edita manualmente los inputs abajo.
                </div>
            )}

            {data.auto_projections?.flags && (() => {
                const f = data.auto_projections.flags;
                const warnings = [];
                if (f.revenue_analyst_suspicious) warnings.push("La estimación de ingresos de analistas parece anómala (muy distinta del último año real). Revisa Ingresos 2y.");
                if (f.revenue_projection_capped) warnings.push("El crecimiento implícito de ingresos se ha capado (>+50% o <−30%). La proyección puede ser conservadora.");
                if (f.fcf_history_has_negatives) warnings.push("El histórico de FCF contiene años negativos. La proyección usa un fallback simplificado.");
                if (f.fcf_projection_capped) warnings.push("El crecimiento histórico del FCF se ha capado para evitar extrapolaciones extremas.");
                if (f.fcf_cagr_fallback) warnings.push("CAGR del FCF a 4 años calculado por fallback (no por la fórmula estándar 2y atrás → 2y adelante).");
                if (f.revenue_cagr_fallback) warnings.push("CAGR de ingresos a 4 años calculado por fallback.");
                if (!warnings.length) return null;
                return (
                    <div className="border border-[#D97706] bg-white p-4 mb-6" data-testid="projection-warnings">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertCircle size={16} className="text-[#D97706]" />
                            <div className="overline text-[#D97706]">Avisos sobre las proyecciones automáticas</div>
                        </div>
                        <ul className="text-xs text-[#4A4A4A] space-y-1 list-disc pl-5 font-sans">
                            {warnings.map((w, i) => <li key={i} data-testid={`warning-${i}`}>{w}</li>)}
                        </ul>
                        <div className="text-[10px] text-[#4A4A4A] mt-2 font-mono">
                            Recomendación: revisa los inputs abajo y ajústalos a tu criterio antes de tomar decisiones.
                        </div>
                    </div>
                );
            })()}

            {/* Inputs grid */}
            <div className="border border-black bg-white mb-6" data-testid="inputs-section">
                <div className="p-4 border-b border-black flex justify-between items-center">
                    <div>
                        <div className="overline text-[#B32A22]">Tus fórmulas</div>
                        <div className="font-serif text-2xl">Inputs y proyecciones</div>
                    </div>
                    <div className="flex gap-2">
                        {edited && <button onClick={handleReset} className="btn-ghost" data-testid="reset-inputs">Reset</button>}
                        <button onClick={handleRecalc} className="btn-primary" data-testid="recalc-button">Recalcular</button>
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                        ["Ingresos proyectados 2y", "revenue_2y", "(magnitud)"],
                        ["FCF proyectado 2y", "fcf_2y", "(magnitud)"],
                        ["Acciones en circulación", "shares_outstanding", "(número)"],
                        ["Margen bruto", "gross_margin", "(decimal, 0.70=70%)"],
                        ["Margen operativo", "operating_margin", "(decimal)"],
                        ["Deuda neta", "net_debt", "(magnitud)"],
                        ["Capitalización", "market_cap", "(magnitud)"],
                        ["CAGR ingresos 4y", "revenue_cagr_4y", "(decimal, 0.40=40%)"],
                        ["CAGR FCF 4y", "fcf_cagr_4y", "(decimal)"],
                        ["Precio acción", "current_price", `(${cur})`],
                    ].map(([label, key, hint]) => (
                        <div key={key} className="p-4 grid-cell">
                            <label className="overline text-[#4A4A4A] block mb-1">{label}</label>
                            <input
                                type="text"
                                inputMode="decimal"
                                className="input-paper text-base"
                                value={fmtInputDisplay(inputs?.[key])}
                                onChange={(e) => updateInput(key, e.target.value)}
                                data-testid={`input-${key}`}
                            />
                            <div className="text-[10px] text-[#4A4A4A] mt-1 font-mono">{hint}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Two-column: Classic ratios + Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="border border-black bg-white" data-testid="classic-ratios">
                    <div className="p-4 border-b border-black">
                        <div className="overline text-[#4A4A4A]">Ratios clásicos</div>
                        <div className="font-serif text-2xl">Valoración estándar</div>
                    </div>
                    <table className="w-full text-sm">
                        <tbody>
                            {ratioRows.map(([label, key, fmt]) => {
                                const v = data.classic_ratios?.[key];
                                const display = v == null ? "—" : fmt === "pct" ? fmtPct(v) : fmtNum(v);
                                return (
                                    <tr key={key} className="border-b border-black/10 hover:bg-[#F5E4D4]">
                                        <td className="px-4 py-2 text-[#4A4A4A]">{label}</td>
                                        <td className="px-4 py-2 text-right font-mono" data-testid={`ratio-${key}`}>{display}</td>
                                    </tr>
                                );
                            })}
                            <tr className="border-b border-black/10 hover:bg-[#F5E4D4]">
                                <td className="px-4 py-2 text-[#4A4A4A]">Gross margin</td>
                                <td className="px-4 py-2 text-right font-mono">{fmtPct(data.gross_margin)}</td>
                            </tr>
                            <tr className="border-b border-black/10 hover:bg-[#F5E4D4]">
                                <td className="px-4 py-2 text-[#4A4A4A]">Operating margin</td>
                                <td className="px-4 py-2 text-right font-mono">{fmtPct(data.operating_margin)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="space-y-6">
                    <ChartBlock title="Ingresos históricos" data={revChart} unit="B" color="#052049" testid="revenue-chart" userEdited={revEdited} />
                    <ChartBlock title="Free Cash Flow histórico" data={fcfChart} unit="B" color="#1D7044" type="bar" testid="fcf-chart" userEdited={fcfEdited} />
                </div>
            </div>

            {/* Breakdown */}
            {cr.breakdown && (
                <div className="border border-black bg-white p-4" data-testid="breakdown-section">
                    <div className="overline text-[#4A4A4A] mb-2">Desglose del cálculo POC</div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm font-mono">
                        <Stat label="Rev/Acción 2y" value={fmtNum(cr.breakdown.rev_per_share_2y)} />
                        <Stat label="× Margen bruto" value={fmtNum(cr.breakdown.margin_factor)} />
                        <Stat label="× (FCF-NetDebt)/MCap %" value={fmtNum(cr.breakdown.fcf_minus_netdebt_over_mcap_pct)} />
                        <Stat label="× CAGR Ingresos 4y" value={fmtNum(cr.breakdown.rev_growth_factor)} />
                        <Stat label="× CAGR FCF 4y" value={fmtNum(cr.breakdown.fcf_growth_factor)} />
                    </div>
                </div>
            )}
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div className="grid-cell p-2">
            <div className="overline text-[#4A4A4A]">{label}</div>
            <div className="text-base">{value}</div>
        </div>
    );
}

function ChartBlock({ title, data, unit, color, type = "line", testid, userEdited = false }) {
    if (!data || data.length === 0) {
        return (
            <div className="border border-black bg-white p-4" data-testid={testid}>
                <div className="overline text-[#4A4A4A] mb-2">{title}</div>
                <div className="text-sm text-[#4A4A4A]">Sin datos disponibles</div>
            </div>
        );
    }
    const projColor = userEdited ? "#052049" : "#B32A22";
    const projLabel = userEdited ? "Estimado por usuario" : "Proyección";
    return (
        <div className="border border-black bg-white p-4" data-testid={testid}>
            <div className="flex items-start justify-between mb-1">
                <div>
                    <div className="overline text-[#4A4A4A]">{title}</div>
                    <div className="font-serif text-xl">en miles de millones ({unit})</div>
                </div>
                <div className="flex gap-3 text-[10px] font-mono mt-1" data-testid={`${testid}-legend`}>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-[2px]" style={{ background: color }} />Real</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-0 border-t-2 border-dashed" style={{ borderColor: projColor }} />{projLabel}</span>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
                {type === "bar" ? (
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#11111120" />
                        <XAxis dataKey="year" stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <YAxis stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <Tooltip contentStyle={{ border: "1px solid #111", borderRadius: 0, fontFamily: "IBM Plex Mono", fontSize: 12 }} />
                        <Bar dataKey="value" name="FCF">
                            {data.map((entry, i) => (
                                <Cell key={i} fill={entry.kind === "proj" ? projColor : color} fillOpacity={entry.kind === "proj" ? 0.45 : 1} stroke={entry.kind === "proj" ? projColor : "none"} strokeDasharray={entry.kind === "proj" ? "3 3" : "0"} />
                            ))}
                        </Bar>
                    </BarChart>
                ) : (
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#11111120" />
                        <XAxis dataKey="year" stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <YAxis stroke="#111" style={{ fontSize: 11, fontFamily: "IBM Plex Mono" }} />
                        <Tooltip contentStyle={{ border: "1px solid #111", borderRadius: 0, fontFamily: "IBM Plex Mono", fontSize: 12 }} />
                        <Line type="monotone" dataKey="historical" stroke={color} strokeWidth={2} dot={{ r: 4, fill: color }} name="Real" connectNulls={false} />
                        <Line type="monotone" dataKey="projection" stroke={projColor} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, fill: projColor }} name="Proyección" connectNulls={false} />
                    </LineChart>
                )}
            </ResponsiveContainer>
        </div>
    );
}
