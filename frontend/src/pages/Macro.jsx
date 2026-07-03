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

// Trailing average of monthly oil history over `years` (shared by oil card + coefficient).
const oilAverage = (history, years) => {
    if (!history || !history.length) return null;
    const n = Math.min(years * 12, history.length);
    const slice = history.slice(history.length - n);
    if (!slice.length) return null;
    return slice.reduce((s, x) => s + x.value, 0) / slice.length;
};

// Coefficient formula (user-defined):
// C = (m71/(m70-m72)) * (1-(m73+m74)/100) * (m75/100) * (1-((m76-m77)*(m78/10000)))
// m70 Renta variable · m71 PIB · m72 M3 proxy · m73 Tipo FED · m74 Inflación
// m75 Productividad · m76 Precio petróleo · m77 Media petróleo (dial) · m78 Mix petróleo+gas
const computeCoefficient = (byKey, oilYears) => {
    const g = (k) => byKey[k]?.value;
    const m70 = g("equities"), m71 = g("gdp"), m72 = g("m3_proxy"), m73 = g("fed_rate"),
        m74 = g("inflation"), m75 = g("productivity"), m76 = g("oil_avg"), m78 = g("energy_mix");
    const m77 = oilAverage(byKey["oil_avg"]?.history, oilYears);
    const vals = { m70, m71, m72, m73, m74, m75, m76, m77, m78 };
    if (Object.values(vals).some((v) => v == null) || m70 - m72 === 0) return null;
    const t1 = m71 / (m70 - m72);
    const t2 = 1 - (m73 + m74) / 100;
    const t3 = m75 / 100;
    const t4 = 1 - ((m76 - m77) * (m78 / 10000));
    return { C: t1 * t2 * t3 * t4, terms: { t1, t2, t3, t4 }, vals };
};

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

const OilAverageCard = ({ ind, years, onYearsChange }) => {
    const Icon = ICONS[ind.key] || Droplet;
    const dial = ind.dial || { min: 1, max: 20, default: 4 };
    const history = ind.history || [];
    const current = ind.value;

    const avg = React.useMemo(() => oilAverage(history, years), [history, years]);

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
                    value={[years]} onValueChange={(v) => onYearsChange(v[0])}
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

const DEFENSIVE = ["KO", "PG", "JNJ", "WM"];
const GROWTH = ["NVDA", "PLTR", "TSLA", "SHOP"];

const CoefficientGauge = ({ c }) => {
    const cx = 130, cy = 122, R = 96;
    const val = Math.max(0, Math.min(2, c));         // clamp to [0,2]
    const rot = (val - 1) * 90;                       // 1→0° (up), 0→-90° (left), 2→+90° (right)
    return (
        <svg viewBox="0 0 260 150" className="w-full max-w-[280px]" data-testid="coef-gauge">
            <defs>
                <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#B32A22" />
                    <stop offset="25%" stopColor="#E8833A" />
                    <stop offset="50%" stopColor="#9AA0A6" />
                    <stop offset="75%" stopColor="#7BC47F" />
                    <stop offset="100%" stopColor="#1F7A3D" />
                </linearGradient>
            </defs>
            <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="url(#gaugeGrad)" strokeWidth="15" strokeLinecap="round" />
            <text x={cx - R} y={cy + 16} textAnchor="middle" className="fill-[#B32A22]" fontSize="10" fontWeight="700">0 · caro</text>
            <text x={cx} y="18" textAnchor="middle" className="fill-[#6A6A6A]" fontSize="10" fontWeight="700">1</text>
            <text x={cx + R} y={cy + 16} textAnchor="middle" className="fill-[#1F7A3D]" fontSize="10" fontWeight="700">2 · barato</text>
            <g transform={`rotate(${rot} ${cx} ${cy})`}>
                <line x1={cx} y1={cy} x2={cx} y2={cy - R + 8} stroke="#052049" strokeWidth="3" strokeLinecap="round" />
            </g>
            <circle cx={cx} cy={cy} r="6" fill="#052049" />
        </svg>
    );
};

const CoefficientCard = ({ byKey, oilYears }) => {
    const res = computeCoefficient(byKey, oilYears);
    if (!res) {
        return (
            <div className="border border-black/20 bg-white p-5 mb-4" data-testid="coef-card">
                <div className="overline text-[#B32A22] mb-1">Coeficiente de mercado</div>
                <div className="text-sm text-[#7A7A7A]">Faltan datos para calcular el coeficiente.</div>
            </div>
        );
    }
    const { C, terms, vals } = res;
    const cheap = C > 1, expensive = C < 1;
    const zoneColor = expensive ? "#B32A22" : cheap ? "#1F7A3D" : "#6A6A6A";
    const verdict = expensive ? "Mercado CARO" : cheap ? "Mercado BARATO" : "Neutral";
    const advice = expensive ? "Sesgo defensivo / efectivo" : cheap ? "Sesgo crecimiento / agresivo" : "Equilibrado";

    const factorRows = [
        ["m70", "Renta variable", vals.m70], ["m71", "PIB", vals.m71], ["m72", "M3 proxy", vals.m72],
        ["m73", "Tipo FED", vals.m73], ["m74", "Inflación", vals.m74], ["m75", "Productividad", vals.m75],
        ["m76", "Precio petróleo", vals.m76], ["m77", `Media petróleo (${oilYears}a)`, vals.m77],
        ["m78", "Mix petróleo+gas", vals.m78],
    ];

    return (
        <div className="border-2 border-[#052049] bg-white p-5 mb-4" data-testid="coef-card">
            <div className="flex items-center justify-between gap-2 mb-3">
                <div className="overline text-[#B32A22]">Coeficiente de mercado</div>
                <HoverTip text={"C = (PIB / (Renta variable − M3 proxy)) × (1 − (Tipo FED + Inflación)/100) × (Productividad/100) × (1 − ((Precio petróleo − Media petróleo) × (Mix petróleo+gas/10000)))\n\nPor debajo de 1 = mercado caro (defensivas/efectivo). Por encima de 1 = mercado barato (crecimiento/agresivas). La media del petróleo (m77) usa los años del dial de la ficha de Petróleo."}>
                    <button className="text-[#9A9A9A] hover:text-[#052049]" data-testid="coef-info" aria-label="Fórmula"><Info size={15} /></button>
                </HoverTip>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
                <div className="flex flex-col items-center">
                    <CoefficientGauge c={C} />
                    <div className="font-serif tabular-nums text-5xl leading-none mt-1" style={{ color: zoneColor }} data-testid="coef-value">{nf.format(C)}</div>
                    <div className="mt-1 text-sm font-semibold" style={{ color: zoneColor }} data-testid="coef-verdict">{verdict} · {advice}</div>
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className={`border p-2.5 ${expensive ? "border-[#B32A22] bg-[#FBE9E7]" : "border-black/15 opacity-60"}`} data-testid="coef-defensive">
                            <div className="text-[11px] uppercase tracking-wide font-semibold text-[#B32A22] mb-1">Caro → Defensivas</div>
                            <div className="text-[13px] text-[#4A4A4A] tabular-nums">{DEFENSIVE.join(" · ")}</div>
                        </div>
                        <div className={`border p-2.5 ${cheap ? "border-[#1F7A3D] bg-[#E9F5EC]" : "border-black/15 opacity-60"}`} data-testid="coef-growth">
                            <div className="text-[11px] uppercase tracking-wide font-semibold text-[#1F7A3D] mb-1">Barato → Crecimiento</div>
                            <div className="text-[13px] text-[#4A4A4A] tabular-nums">{GROWTH.join(" · ")}</div>
                        </div>
                    </div>
                    <div className="border-t border-black/10 pt-2">
                        <div className="text-[10px] uppercase tracking-wide text-[#9A9A9A] mb-1">Valores usados</div>
                        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
                            {factorRows.map(([code, label, v]) => (
                                <div key={code} className="flex justify-between gap-1">
                                    <span className="text-[#7A7A7A] truncate" title={label}>{label}</span>
                                    <span className="text-[#052049] font-medium">{v == null ? "—" : nf.format(v)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function Macro() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [oilYears, setOilYears] = useState(4);  // shared oil dial value → feeds m77 of the coefficient

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
                    <CoefficientCard
                        byKey={Object.fromEntries(data.indicators.map((i) => [i.key, i]))}
                        oilYears={oilYears}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="macro-grid">
                        {data.indicators.map((ind) => (
                            ind.key === "oil_avg"
                                ? <OilAverageCard key={ind.key} ind={ind} years={oilYears} onYearsChange={setOilYears} />
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
