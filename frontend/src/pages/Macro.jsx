import React, { useState, useEffect, useCallback } from "react";
import { Globe2, Info, RefreshCw, Loader2, TrendingUp, Percent, Flame, Gauge, Landmark, Droplet, Layers, Zap, AlertTriangle } from "lucide-react";
import { macroIndicators } from "@/lib/api";
import HoverTip from "@/components/HoverTip";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";

const ICONS = {
    equities: TrendingUp,
    gdp: Landmark,
    fed_rate: Percent,
    inflation: Flame,
    productivity: Gauge,
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
        case "equities":
        case "gdp":
        case "productivity":
        case "m3_proxy":
            return e.yoy_pct != null ? `Crecimiento interanual: ${signedPct(e.yoy_pct)}` : null;
        case "inflation":
            return e.index_value != null ? `Índice CPI: ${nf.format(e.index_value)} (${e.index_base})` : null;
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
        <div className="border border-black/20 bg-white p-3 flex flex-col" data-testid={`macro-card-${ind.key}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5">
                    <Icon size={13} className="text-[#052049]" /> {ind.label}
                </div>
                <HoverTip text={`${ind.description}\n\n${ind.interpretation}\n\nFuente: ${ind.source} · ${ind.frequency}${ind.note ? `\n\n${ind.note}` : ""}`}>
                    <button className="text-[#9A9A9A] hover:text-[#052049] shrink-0" data-testid={`macro-info-${ind.key}`} aria-label="Más información">
                        <Info size={14} />
                    </button>
                </HoverTip>
            </div>

            <div className="flex items-baseline gap-1.5">
                <span className="font-serif tabular-nums text-3xl text-[#052049] leading-none" data-testid={`macro-value-${ind.key}`}>
                    {fmtVal(ind.value)}
                </span>
                <span className="text-xs text-[#4A4A4A] font-medium">{ind.unit}</span>
            </div>

            <div className="text-[11px] text-[#7A7A7A] mt-1.5">{ind.interpretation}</div>
            {extra && <div className="text-[11px] text-[#9A9A9A] mt-1 tabular-nums">{extra}</div>}

            {ind.components && (
                <div className="mt-3 border-t border-black/10 pt-2" data-testid={`macro-breakdown-${ind.key}`}>
                    <div className="text-[10px] uppercase tracking-wide text-[#9A9A9A] mb-1">Desglose (miles de M$)</div>
                    {ind.components.map((c) => (
                        <div key={c.series} className="flex items-center justify-between text-[11px] tabular-nums py-0.5">
                            <span className="text-[#4A4A4A]">
                                {c.label}
                                {c.frozen && <span className="text-[#B8860B] not-italic ml-1" title="Congelado: última lectura válida">⚠ congelado</span>}
                            </span>
                            <span className="text-[#052049] font-medium">{fmtVal(c.value)}</span>
                        </div>
                    ))}
                    {ind.formula && (
                        <div className="text-[10px] text-[#7A7A7A] mt-1.5 leading-snug border-t border-black/5 pt-1.5" data-testid={`macro-formula-${ind.key}`}>
                            {ind.formula}
                        </div>
                    )}
                    {ind.warning && (
                        <div className="mt-2 flex items-start gap-1.5 text-[10px] text-[#8a2318] bg-[#FBE9E7] border border-[#B32A22]/40 p-1.5 leading-snug" data-testid={`macro-warning-${ind.key}`}>
                            <AlertTriangle size={12} className="text-[#B32A22] shrink-0 mt-0.5" />
                            <span>{ind.warning}</span>
                        </div>
                    )}
                </div>
            )}

            <div className="mt-auto pt-2.5 flex items-center justify-between text-[11px]">
                <span className="uppercase tracking-wide text-[#7A7A7A] font-medium">{ind.frequency}</span>
                {ind.stale ? (
                    <span className="inline-flex items-center gap-1 text-[#B8860B] font-semibold" data-testid={`macro-stale-${ind.key}`} title="La fuente ya no actualiza esta serie; es el último dato disponible">
                        <AlertTriangle size={12} /> Desactualizada · {fmtDate(ind.as_of)}
                    </span>
                ) : (
                    <span className="tabular-nums text-[#052049] font-semibold" data-testid={`macro-asof-${ind.key}`}>Dato: {fmtDate(ind.as_of)}</span>
                )}
            </div>
        </div>
    );
};

const OilAverageCard = ({ ind }) => {
    const Icon = ICONS[ind.key] || Droplet;
    const dial = ind.dial || { min: 1, max: 20, default: 4 };
    const [years, setYears] = useState(dial.default);
    const history = ind.history || [];
    const current = ind.value;

    const avg = React.useMemo(() => {
        if (!history.length) return null;
        const n = Math.min(years * 12, history.length);
        const slice = history.slice(history.length - n);
        if (!slice.length) return null;
        return slice.reduce((s, x) => s + x.value, 0) / slice.length;
    }, [history, years]);

    const diffPct = avg != null && current != null && avg !== 0 ? ((current - avg) / avg) * 100 : null;
    const expensive = diffPct != null && diffPct > 0;
    const diffColor = diffPct == null ? "#4A4A4A" : expensive ? "#B32A22" : "#1F7A3D";
    const spanYears = history.length ? (history.length / 12) : 0;
    const capped = years * 12 > history.length;

    return (
        <div className="border border-black/20 bg-white p-3 flex flex-col" data-testid={`macro-card-${ind.key}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5">
                    <Icon size={13} className="text-[#052049]" /> {ind.label}
                </div>
                <HoverTip text={`${ind.description}\n\nFuente: ${ind.source} · ${ind.frequency}`}>
                    <button className="text-[#9A9A9A] hover:text-[#052049] shrink-0" data-testid={`macro-info-${ind.key}`} aria-label="Más información">
                        <Info size={14} />
                    </button>
                </HoverTip>
            </div>

            <div className="flex items-baseline gap-1.5">
                <span className="font-serif tabular-nums text-3xl text-[#052049] leading-none" data-testid={`macro-value-${ind.key}`}>
                    {fmtVal(current)}
                </span>
                <span className="text-xs text-[#4A4A4A] font-medium">{ind.unit} · actual</span>
            </div>

            <div className="mt-3 border-t border-black/10 pt-2.5">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] uppercase tracking-wide text-[#7A7A7A] font-medium">Media últimos</span>
                    <span className="text-[13px] font-serif text-[#052049] tabular-nums" data-testid="oil-avg-years">{years} {years === 1 ? "año" : "años"}</span>
                </div>
                <Slider
                    min={dial.min} max={dial.max} step={1}
                    value={[years]} onValueChange={(v) => setYears(v[0])}
                    className="my-2" data-testid="oil-avg-slider"
                />
                <div className="flex items-baseline justify-between mt-2.5">
                    <span className="text-[11px] text-[#7A7A7A]">Media del periodo</span>
                    <span className="font-serif tabular-nums text-2xl text-[#052049]" data-testid="oil-avg-value">
                        {avg != null ? nf.format(avg) : "—"} <span className="text-xs text-[#4A4A4A]">USD/barril</span>
                    </span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-[#7A7A7A]">Actual vs media</span>
                    <span className="text-[13px] font-semibold tabular-nums" style={{ color: diffColor }} data-testid="oil-avg-diff">
                        {diffPct != null ? `${diffPct > 0 ? "+" : ""}${nf.format(diffPct)}% · ${expensive ? "caro" : "barato"}` : "—"}
                    </span>
                </div>
                {capped && <div className="text-[10px] text-[#B8860B] mt-1.5">Solo hay ~{Math.floor(spanYears)} años de histórico; se usa todo el disponible.</div>}
            </div>

            <div className="mt-auto pt-2.5 flex items-center justify-between text-[11px]">
                <span className="uppercase tracking-wide text-[#7A7A7A] font-medium">{ind.frequency}</span>
                <span className="tabular-nums text-[#052049] font-semibold">Dato: {fmtDate(ind.as_of)}</span>
            </div>
        </div>
    );
};

const EnergyMixCard = ({ ind }) => {
    const comps = ind.components || [];
    const maxPct = comps.length ? Math.max(...comps.map((c) => c.pct)) : 100;
    return (
        <div className="border border-black/20 bg-white p-3 flex flex-col" data-testid="macro-card-energy_mix">
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5">
                    <Zap size={13} className="text-[#052049]" /> {ind.label}
                </div>
                <HoverTip text={`${ind.description}\n\n${ind.interpretation}\n\nFuente: ${ind.source} · ${ind.frequency}`}>
                    <button className="text-[#9A9A9A] hover:text-[#052049] shrink-0" data-testid="macro-info-energy_mix" aria-label="Más información">
                        <Info size={14} />
                    </button>
                </HoverTip>
            </div>

            <div className="flex items-baseline gap-1.5">
                <span className="font-serif tabular-nums text-3xl text-[#052049] leading-none" data-testid="macro-value-energy_mix">{fmtVal(ind.value)}</span>
                <span className="text-xs text-[#4A4A4A] font-medium">% petróleo + gas</span>
            </div>
            <div className="text-[11px] text-[#7A7A7A] mt-1.5">Cuota de petróleo + gas natural sobre el total de energía primaria</div>

            <div className="mt-3 border-t border-black/10 pt-2 space-y-1" data-testid="macro-breakdown-energy_mix">
                <div className="text-[10px] uppercase tracking-wide text-[#9A9A9A] mb-1">Desglose por fuente</div>
                {comps.map((c) => (
                    <div key={c.label} data-testid={`energy-src-${c.label}`}>
                        <div className="flex items-center justify-between text-[11px] tabular-nums">
                            <span className="text-[#4A4A4A]">{c.label}</span>
                            <span className="text-[#052049] font-medium">{fmtVal(c.pct)}%</span>
                        </div>
                        <div className="h-1 bg-black/10 mt-0.5"><div className="h-full bg-[#052049]" style={{ width: `${(c.pct / maxPct) * 100}%` }} /></div>
                    </div>
                ))}
            </div>

            <div className="mt-auto pt-2.5 flex items-center justify-between text-[11px]">
                <span className="uppercase tracking-wide text-[#7A7A7A] font-medium">{ind.frequency}</span>
                <span className="tabular-nums text-[#052049] font-semibold">Datos: {ind.as_of}</span>
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
                        {data.indicators.map((ind) => (
                            ind.key === "oil_avg"
                                ? <OilAverageCard key={ind.key} ind={ind} />
                                : ind.key === "energy_mix"
                                    ? <EnergyMixCard key={ind.key} ind={ind} />
                                    : <MacroCard key={ind.key} ind={ind} />
                        ))}
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
