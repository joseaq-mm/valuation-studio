import React, { useState, useEffect, useCallback } from "react";
import { Globe2, Info, RefreshCw, Loader2, TrendingUp, Percent, Flame, Gauge, Banknote, Droplet, Layers, AlertTriangle } from "lucide-react";
import { macroIndicators } from "@/lib/api";
import HoverTip from "@/components/HoverTip";
import { toast } from "sonner";

const ICONS = {
    buffett: TrendingUp,
    fed_rate: Percent,
    inflation: Flame,
    productivity: Gauge,
    m2_growth: Banknote,
    m3_proxy: Layers,
    oil: Droplet,
};

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
const fmtVal = (v) => (v == null ? "—" : nf.format(v));
const fmtDate = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso; }
};

const signedPct = (v) => (v == null ? null : `${v > 0 ? "+" : ""}${nf.format(v)}%`);

// Per-indicator secondary line (context value, in its native unit/currency).
const extraLine = (ind) => {
    const e = ind.extra || {};
    switch (ind.key) {
        case "buffett":
            return e.market_cap_busd != null
                ? `Renta variable: ${nf.format(e.market_cap_busd)} B$ · PIB: ${nf.format(e.gdp_busd)} B$`
                : null;
        case "inflation":
            return e.index_value != null ? `Índice CPI: ${nf.format(e.index_value)} (${e.index_base})` : null;
        case "productivity":
            return e.index_value != null ? `Índice: ${nf.format(e.index_value)} (${e.index_base})` : null;
        case "m2_growth":
            return e.level_busd != null ? `Nivel M2: ${nf.format(e.level_busd)} B$` : null;
        case "m3_proxy":
            return e.yoy_pct != null ? `Crecimiento interanual: ${signedPct(e.yoy_pct)}` : null;
        case "oil":
            return e.change_30d_pct != null ? `~30 días: ${signedPct(e.change_30d_pct)}` : null;
        default:
            return null;
    }
};

const MacroCard = ({ ind }) => {
    const Icon = ICONS[ind.key] || Globe2;
    const extra = extraLine(ind);
    return (
        <div className="border border-black/20 bg-white p-4 flex flex-col" data-testid={`macro-card-${ind.key}`}>
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5">
                    <Icon size={14} className="text-[#052049]" /> {ind.label}
                </div>
                <HoverTip text={`${ind.description}\n\n${ind.interpretation}\n\nFuente: ${ind.source} · ${ind.frequency}${ind.note ? `\n\n${ind.note}` : ""}`}>
                    <button className="text-[#9A9A9A] hover:text-[#052049] shrink-0" data-testid={`macro-info-${ind.key}`} aria-label="Más información">
                        <Info size={15} />
                    </button>
                </HoverTip>
            </div>

            <div className="flex items-baseline gap-1.5">
                <span className="font-serif tabular-nums text-4xl text-[#052049] leading-none" data-testid={`macro-value-${ind.key}`}>
                    {fmtVal(ind.value)}
                </span>
                <span className="text-sm text-[#4A4A4A] font-medium">{ind.unit}</span>
            </div>

            <div className="text-[11px] text-[#7A7A7A] mt-2">{ind.interpretation}</div>
            {extra && <div className="text-[11px] text-[#9A9A9A] mt-1 tabular-nums">{extra}</div>}

            {ind.components && (
                <div className="mt-3 border-t border-black/10 pt-2" data-testid={`macro-breakdown-${ind.key}`}>
                    <div className="text-[10px] uppercase tracking-wide text-[#9A9A9A] mb-1">Desglose (miles de M$)</div>
                    {ind.components.map((c) => (
                        <div key={c.series} className="flex items-center justify-between text-[11px] tabular-nums py-0.5">
                            <span className="text-[#4A4A4A]">{c.label}</span>
                            <span className="text-[#052049] font-medium">{fmtVal(c.value)}</span>
                        </div>
                    ))}
                    {ind.formula && (
                        <div className="text-[10px] text-[#7A7A7A] mt-1.5 leading-snug border-t border-black/5 pt-1.5" data-testid={`macro-formula-${ind.key}`}>
                            {ind.formula}
                        </div>
                    )}
                </div>
            )}

            <div className="mt-auto pt-3 flex items-center justify-between text-[10px] text-[#9A9A9A]">
                <span className="uppercase tracking-wide">{ind.frequency}</span>
                {ind.stale ? (
                    <span className="inline-flex items-center gap-1 text-[#B8860B] font-semibold" data-testid={`macro-stale-${ind.key}`} title="La fuente ya no actualiza esta serie; es el último dato disponible">
                        <AlertTriangle size={11} /> Desactualizada · {fmtDate(ind.as_of)}
                    </span>
                ) : (
                    <span className="tabular-nums">Dato: {fmtDate(ind.as_of)}</span>
                )}
            </div>
        </div>
    );
};

export default function Macro() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async (refresh = false) => {
        if (refresh) setRefreshing(true); else setLoading(true);
        try {
            const d = await macroIndicators(refresh);
            setData(d);
            if (refresh) toast.success("Datos macro actualizados");
        } catch (e) {
            toast.error(e?.response?.data?.detail || "No se pudieron cargar los datos macro");
        } finally {
            setLoading(false); setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(false); }, [load]);

    return (
        <div data-testid="macro-page">
            <div className="overline text-[#B32A22] mb-1">Contexto de mercado · EEUU</div>
            <div className="flex items-end justify-between gap-3 flex-wrap mb-2">
                <h1 className="font-serif text-4xl sm:text-5xl text-[#052049] flex items-center gap-2">
                    <Globe2 size={32} className="text-[#052049]" /> Macro
                </h1>
                <button
                    onClick={() => load(true)}
                    disabled={refreshing || loading}
                    className="btn-ghost inline-flex items-center gap-1.5 disabled:opacity-40"
                    data-testid="macro-refresh-btn"
                >
                    {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualizar
                </button>
            </div>
            <p className="text-[#4A4A4A] max-w-3xl mb-6">
                Indicadores macroeconómicos de EEUU que enmarcan si la bolsa está cara o barata y en qué entorno
                financiero nos movemos. Pasa el ratón por el icono <Info size={13} className="inline -mt-0.5 text-[#052049]" /> de cada
                tarjeta para ver qué mide y en qué unidades. <strong>Fuente: FRED (Reserva Federal de St. Louis).</strong>
            </p>

            {loading ? (
                <div className="flex items-center gap-2 text-[#4A4A4A] py-10" data-testid="macro-loading">
                    <Loader2 size={18} className="animate-spin" /> Cargando datos de FRED…
                </div>
            ) : data?.indicators?.length ? (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="macro-grid">
                        {data.indicators.map((ind) => <MacroCard key={ind.key} ind={ind} />)}
                    </div>
                    <p className="text-[11px] text-[#9A9A9A] mt-4" data-testid="macro-updated">
                        Datos cacheados y refrescados periódicamente desde FRED.
                        {data.updated_at && ` Última sincronización: ${new Date(data.updated_at).toLocaleString("es-ES")}.`}
                    </p>
                </>
            ) : (
                <div className="text-[#9A9A9A] py-10" data-testid="macro-empty">Sin datos disponibles.</div>
            )}
        </div>
    );
}
