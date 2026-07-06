import React, { useState, useEffect, useCallback } from "react";
import { Globe2, Info, RefreshCw, Loader2, TrendingUp, Percent, Flame, Gauge, Landmark, Droplet, Layers, Zap, AlertTriangle, Maximize2, X, LineChart as LineChartIcon } from "lucide-react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer, LineChart, ReferenceLine, ReferenceArea } from "recharts";
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

// Live (extrapolated) values: equities via the chosen market index, GDP via prorated YoY.
// Fall back to the official value when the live estimate is unavailable.
const liveEquities = (ind, idx) => ind?.live?.by_index?.[idx]?.value ?? ind?.value;
const liveGdp = (ind) => ind?.live?.value ?? ind?.value;

// Coefficient formula (user-defined):
// C = (m71/(m70-m72)) * (1-(m73+m74)/100) * (m75/100) * (1-((m76-m77)*(m78/10000)))
// m70 Renta variable · m71 PIB · m72 M3 proxy · m73 Tipo FED · m74 Inflación
// m75 Productividad · m76 Precio petróleo · m77 Media petróleo (dial) · m78 Mix petróleo+gas
const computeCoefficient = (byKey, oilYears, selectedIndex) => {
    const g = (k) => byKey[k]?.value;
    const m70 = liveEquities(byKey["equities"], selectedIndex), m71 = liveGdp(byKey["gdp"]),
        m72 = g("m3_proxy"), m73 = g("fed_rate"),
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

const LiveIndicatorCard = ({ ind, selectedIndex, onIndexChange }) => {
    const Icon = ICONS[ind.key] || Globe2;
    const isEquities = ind.key === "equities";
    const live = ind.live;
    const byIndex = live?.by_index || {};
    const liveVal = isEquities ? (byIndex[selectedIndex]?.value ?? null) : (live?.value ?? null);
    const est = isEquities ? byIndex[selectedIndex] : live;
    const hasLive = liveVal != null;

    const tip = isEquities
        ? `${ind.description}\n\nEstimación EN VIVO: se toma el último valor oficial (${fmtDate(ind.as_of)}) y se ajusta por la variación del índice ${est?.label || selectedIndex} desde esa fecha (${est ? signedPct(est.growth_pct) : "—"}). Índice: ${est ? `${nf.format(est.index_ref)} → ${nf.format(est.index_now)}` : "—"}.\n\nFuente: ${ind.source} · ${ind.frequency}`
        : `${ind.description}\n\nEstimación EN VIVO: al último PIB oficial (${fmtDate(ind.as_of)}) se le aplica el crecimiento interanual nominal (${est ? signedPct(est.yoy_pct) : "—"}) prorrateado por ${est?.days_elapsed ?? "—"} días transcurridos.\n\nFuente: ${ind.source} · ${ind.frequency}`;

    return (
        <div className="border border-black/20 bg-white p-3 flex flex-col" data-testid={`macro-card-${ind.key}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5">
                    <Icon size={13} className="text-[#052049]" /> {ind.label}
                </div>
                <HoverTip text={tip}>
                    <button className="text-[#9A9A9A] hover:text-[#052049] shrink-0" data-testid={`macro-info-${ind.key}`} aria-label="Más información">
                        <Info size={14} />
                    </button>
                </HoverTip>
            </div>

            <div className="flex items-baseline gap-1.5">
                <span className="font-serif tabular-nums text-3xl text-[#052049] leading-none" data-testid={`macro-value-${ind.key}`}>
                    {fmtVal(hasLive ? liveVal : ind.value)}
                </span>
                <span className="text-xs text-[#4A4A4A] font-medium">{ind.unit}{hasLive ? " · est." : ""}</span>
            </div>
            {hasLive && (
                <div className="text-[11px] text-[#7A7A7A] mt-1 tabular-nums" data-testid={`macro-official-${ind.key}`}>
                    Oficial: {fmtVal(ind.value)} {ind.unit} ({fmtDate(ind.as_of)})
                    {isEquities && est?.growth_pct != null && <span className="text-[#9A9A9A]"> · {est.label} {signedPct(est.growth_pct)}</span>}
                    {!isEquities && est?.yoy_pct != null && <span className="text-[#9A9A9A]"> · interanual {signedPct(est.yoy_pct)}</span>}
                </div>
            )}

            {isEquities && Object.keys(byIndex).length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-[#9A9A9A]">Índice ref.</span>
                    <select
                        value={selectedIndex}
                        onChange={(e) => onIndexChange(e.target.value)}
                        className="text-[11px] border border-black/20 bg-white px-1.5 py-0.5 text-[#052049] focus:outline-none focus:border-[#052049]"
                        data-testid="equities-index-select"
                    >
                        {Object.entries(byIndex).map(([code, v]) => (
                            <option key={code} value={code}>{v.label}</option>
                        ))}
                    </select>
                </div>
            )}

            <div className="text-[11px] text-[#7A7A7A] mt-1.5">{ind.interpretation}</div>

            <div className="mt-auto pt-2.5 flex items-center justify-between text-[11px]">
                <span className="uppercase tracking-wide text-[#7A7A7A] font-medium">{ind.frequency}</span>
                <span className="tabular-nums text-[#052049] font-semibold" data-testid={`macro-asof-${ind.key}`}>
                    {hasLive ? "Estimado: hoy" : `Dato: ${fmtDate(ind.as_of)}`}
                </span>
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

const dLabel = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }); }
    catch { return iso; }
};

const CoefHistTip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
        <div className="bg-[#111111] text-white text-[11px] p-2 border border-black" data-testid="coef-hist-tooltip">
            <div className="font-semibold">{dLabel(p.date)}</div>
            <div className="tabular-nums">Coef.: {nf.format(p.c)} · {p.c > 1 ? "barato" : p.c < 1 ? "caro" : "neutro"}</div>
        </div>
    );
};

const CoefHistoryChart = ({ history, height, small }) => {
    if (!history?.length) return null;
    return (
        <ResponsiveContainer width="100%" height={height}>
            <LineChart data={history} margin={{ top: 6, right: small ? 4 : 40, left: small ? -22 : 0, bottom: 0 }}>
                <CartesianGrid stroke="#00000010" vertical={false} />
                <ReferenceArea y1={1} y2={100} fill="#1F7A3D" fillOpacity={0.07} />
                <ReferenceArea y1={0} y2={1} fill="#B32A22" fillOpacity={0.07} />
                <XAxis dataKey="date" tickFormatter={dLabel} tick={{ fontSize: small ? 8 : 11, fill: "#7A7A7A" }} interval={Math.max(0, Math.ceil(history.length / (small ? 4 : 10)) - 1)} axisLine={{ stroke: "#00000022" }} tickLine={false} minTickGap={small ? 12 : 20} />
                <YAxis domain={[(min) => Math.min(0.9, min), (max) => Math.max(1.1, max)]} tick={{ fontSize: small ? 8 : 11, fill: "#7A7A7A" }} width={small ? 26 : 40} axisLine={false} tickLine={false} tickFormatter={(v) => nf.format(v)} />
                <ReferenceLine y={1} stroke="#6A6A6A" strokeDasharray="4 3" label={small ? null : { value: "1 · neutro", position: "right", fontSize: 10, fill: "#6A6A6A" }} />
                <RTooltip content={<CoefHistTip />} />
                <Line type="monotone" dataKey="c" stroke="#052049" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
        </ResponsiveContainer>
    );
};

const CoefHistoryModal = ({ history, onClose }) => (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose} data-testid="coef-history-modal">
        <div className="bg-white border-2 border-[#052049] w-full max-w-4xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-serif text-2xl text-[#052049] flex items-center gap-2"><LineChartIcon size={22} /> Histórico del coeficiente</h2>
                <button onClick={onClose} className="text-[#7A7A7A] hover:text-[#052049]" data-testid="coef-history-modal-close" aria-label="Cerrar"><X size={20} /></button>
            </div>
            <CoefHistoryChart history={history} height={420} />
            <p className="text-[11px] text-[#7A7A7A] mt-3 leading-relaxed">
                Un punto por día (valores por defecto: renta variable vía S&amp;P 500 y media del petróleo a 4 años). <span className="text-[#1F7A3D] font-semibold">Zona verde</span> (por encima de 1) = mercado barato; <span className="text-[#B32A22] font-semibold">zona roja</span> (por debajo de 1) = caro. El histórico crece cada día al refrescar los datos macro.
            </p>
        </div>
    </div>
);

const CoefficientCard = ({ byKey, oilYears, selectedIndex, coefHistory }) => {
    const [histOpen, setHistOpen] = useState(false);
    const res = computeCoefficient(byKey, oilYears, selectedIndex);
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
    const pctToOne = (C - 1) * 100;
    const absPct = `${nf.format(Math.abs(pctToOne))}%`;
    const zoneColor = expensive ? "#B32A22" : cheap ? "#1F7A3D" : "#6A6A6A";
    const verdict = expensive ? "Mercado CARO" : cheap ? "Mercado BARATO" : "Neutral";
    const advice = expensive ? "Sesgo defensivo / efectivo" : cheap ? "Sesgo crecimiento / agresivo" : "Equilibrado";

    const factorRows = [
        ["m70", "Renta variable (est.)", vals.m70], ["m71", "PIB (est.)", vals.m71], ["m72", "M3 proxy", vals.m72],
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
                    <div className="flex items-baseline gap-1.5 mt-1">
                        <span className="font-serif tabular-nums text-5xl leading-none" style={{ color: zoneColor }} data-testid="coef-value">{nf.format(C)}</span>
                        <span className="text-sm font-semibold tabular-nums" style={{ color: zoneColor }} data-testid="coef-pct-to-one" title="Diferencia hasta 1 (neutro). En 1 = 0%.">
                            {`${C - 1 > 0 ? "+" : ""}${nf.format((C - 1) * 100)}%`}
                        </span>
                    </div>
                    <div className="mt-1 text-sm font-semibold" style={{ color: zoneColor }} data-testid="coef-verdict">{verdict} · {advice}</div>
                    {coefHistory?.length > 1 && (
                        <div className="w-full mt-3 border-t border-black/10 pt-2" data-testid="coef-history-mini">
                            <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] uppercase tracking-wide text-[#9A9A9A]">Histórico · {coefHistory.length}d</span>
                                <button onClick={() => setHistOpen(true)} className="text-[#9A9A9A] hover:text-[#052049]" data-testid="coef-history-expand-btn" aria-label="Ampliar histórico" title="Ampliar">
                                    <Maximize2 size={13} />
                                </button>
                            </div>
                            <CoefHistoryChart history={coefHistory} height={84} small />
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div className={`border p-2.5 ${expensive ? "border-[#B32A22] bg-[#FBE9E7]" : "border-black/15 opacity-60"}`} data-testid="coef-defensive">
                            <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-[11px] uppercase tracking-wide font-semibold text-[#B32A22]">Caro → Defensivas/efectivo</span>
                                {expensive && <span className="font-semibold tabular-nums text-[11px] text-[#B32A22]" data-testid="coef-defensive-pct">{absPct}</span>}
                            </div>
                            <div className="text-[13px] text-[#4A4A4A] tabular-nums">{DEFENSIVE.join(" · ")}</div>
                        </div>
                        <div className={`border p-2.5 ${cheap ? "border-[#1F7A3D] bg-[#E9F5EC]" : "border-black/15 opacity-60"}`} data-testid="coef-growth">
                            <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-[11px] uppercase tracking-wide font-semibold text-[#1F7A3D]">Barato → Crecimiento/smallcaps</span>
                                {cheap && <span className="font-semibold tabular-nums text-[11px] text-[#1F7A3D]" data-testid="coef-growth-pct">{absPct}</span>}
                            </div>
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
            {histOpen && <CoefHistoryModal history={coefHistory} onClose={() => setHistOpen(false)} />}
        </div>
    );
};

const qLabel = (iso) => {
    if (iso === "est") return "Est.";
    const [y, m] = iso.split("-");
    const q = { "01": "1T", "04": "2T", "07": "3T", "10": "4T" }[m] || "";
    return `${q}${y.slice(2)}`;
};

const TREND_SERIES = [
    { key: "equities", label: "Renta variable", color: "#052049", axis: "left" },
    { key: "gdp", label: "PIB", color: "#1F7A3D", axis: "left" },
    { key: "diff", label: "RV − PIB", color: "#B8860B", axis: "left" },
    { key: "productivity", label: "Productividad", color: "#B32A22", axis: "right" },
];

const mkDot = (color) => (props) => {
    const { cx, cy, payload, index } = props;
    if (cx == null || cy == null || !payload?.est) return <g key={index} />;
    return <circle key={index} cx={cx} cy={cy} r={4.5} fill="#fff" stroke={color} strokeWidth={2} />;
};

const TrendTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const est = payload[0]?.payload?.est;
    return (
        <div className="bg-[#111111] text-white text-[11px] p-2 border border-black" data-testid="trend-tooltip">
            <div className="font-semibold mb-1">{qLabel(label)}{est ? " · estimado" : ""}</div>
            {payload.map((p) => (
                <div key={p.dataKey} className="flex justify-between gap-3 tabular-nums">
                    <span style={{ color: p.color }}>{p.name}</span>
                    <span>{p.value == null ? "—" : nf.format(p.value)}<span className="text-[#9CA3AF]"> {p.dataKey === "productivity" ? "índ." : "mM$"}</span></span>
                </div>
            ))}
        </div>
    );
};

const TrendChart = ({ data, height, small }) => (
    <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 6, left: small ? -14 : 4, bottom: 0 }}>
            <CartesianGrid stroke="#00000010" vertical={false} />
            <XAxis dataKey="date" tickFormatter={qLabel} tick={{ fontSize: small ? 9 : 11, fill: "#7A7A7A" }} interval={small ? 6 : 3} axisLine={{ stroke: "#00000022" }} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fontSize: small ? 9 : 11, fill: "#7A7A7A" }} width={small ? 32 : 48} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: small ? 9 : 11, fill: "#B32A22" }} width={small ? 26 : 40} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <RTooltip content={<TrendTip />} />
            {!small && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {TREND_SERIES.map((s) => (
                <Line key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={mkDot(s.color)} activeDot={{ r: 3 }} connectNulls isAnimationActive={false} />
            ))}
        </ComposedChart>
    </ResponsiveContainer>
);

// Official quarterly points + an estimated last point (live equities via selected index + live GDP).
const buildTrendData = (points, byKey, selectedIndex) => {
    const base = (points || []).map((p) => ({ ...p }));
    const eLive = byKey?.equities?.live?.by_index?.[selectedIndex]?.value;
    const gLive = byKey?.gdp?.live?.value;
    if (eLive != null && gLive != null && base.length) {
        const lastProd = [...base].reverse().find((p) => p.productivity != null)?.productivity ?? null;
        base.push({ date: "est", equities: eLive, gdp: gLive, diff: +(eLive - gLive).toFixed(1), productivity: lastProd, est: true });
    }
    return base;
};

const TrendCard = ({ points, byKey, selectedIndex, onExpand }) => {
    const data = React.useMemo(() => buildTrendData(points, byKey, selectedIndex), [points, byKey, selectedIndex]);
    if (!data.length) return null;
    return (
        <div className="border border-black/20 bg-white p-3 flex flex-col" data-testid="macro-card-trend">
            <div className="flex items-start justify-between gap-2 mb-2">
                <div className="overline text-[#4A4A4A] flex items-center gap-1.5">
                    <LineChartIcon size={13} className="text-[#052049]" /> Evolución · 10 años
                </div>
                <button onClick={onExpand} className="text-[#9A9A9A] hover:text-[#052049] shrink-0" data-testid="trend-expand-btn" aria-label="Ampliar gráfico" title="Ampliar">
                    <Maximize2 size={14} />
                </button>
            </div>
            <TrendChart data={data} height={150} small />
            <div className="text-[10px] text-[#9A9A9A] mt-1.5 leading-snug">
                Trimestral. El último punto (<span className="text-[#052049] font-semibold">Est.</span>) usa valores estimados. Eje dcho.: productividad.
            </div>
        </div>
    );
};

const TrendModal = ({ points, byKey, selectedIndex, onClose }) => {
    const data = React.useMemo(() => buildTrendData(points, byKey, selectedIndex), [points, byKey, selectedIndex]);
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose} data-testid="trend-modal">
            <div className="bg-white border-2 border-[#052049] w-full max-w-5xl p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-serif text-2xl text-[#052049] flex items-center gap-2">
                        <LineChartIcon size={22} className="text-[#052049]" /> Evolución macro · 10 años (trimestral)
                    </h2>
                    <button onClick={onClose} className="text-[#7A7A7A] hover:text-[#052049]" data-testid="trend-modal-close" aria-label="Cerrar"><X size={20} /></button>
                </div>
                <TrendChart data={data} height={460} />
                <p className="text-[11px] text-[#7A7A7A] mt-3 leading-relaxed">
                    Renta variable, PIB y su resta (RV − PIB) en el <strong>eje izquierdo</strong> (miles de M$); Productividad en el <strong>eje derecho</strong> (índice 2017=100).
                    Valores oficiales trimestrales; el último punto marcado como <strong>Est.</strong> usa los valores estimados en vivo (Renta variable con el índice {selectedIndex}, PIB con crecimiento interanual prorrateado).
                </p>
            </div>
        </div>
    );
};

export default function Macro() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [oilYears, setOilYears] = useState(4);  // shared oil dial value → feeds m77 of the coefficient
    const [selectedIndex, setSelectedIndex] = useState("SP500");  // market index for live equities
    const [trendOpen, setTrendOpen] = useState(false);

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
                        selectedIndex={selectedIndex}
                        coefHistory={data.coef_history}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="macro-grid">
                        {data.indicators.map((ind) => (
                            (ind.key === "equities" || ind.key === "gdp")
                                ? <LiveIndicatorCard key={ind.key} ind={ind} selectedIndex={selectedIndex} onIndexChange={setSelectedIndex} />
                                : ind.key === "oil_avg"
                                    ? <OilAverageCard key={ind.key} ind={ind} years={oilYears} onYearsChange={setOilYears} />
                                    : ind.key === "energy_mix"
                                        ? <EnergyMixCard key={ind.key} ind={ind} />
                                        : <MacroCard key={ind.key} ind={ind} />
                        ))}
                        {data.trend?.points?.length > 0 && (
                            <TrendCard
                                points={data.trend.points}
                                byKey={Object.fromEntries(data.indicators.map((i) => [i.key, i]))}
                                selectedIndex={selectedIndex}
                                onExpand={() => setTrendOpen(true)}
                            />
                        )}
                    </div>
                    {trendOpen && (
                        <TrendModal
                            points={data.trend.points}
                            byKey={Object.fromEntries(data.indicators.map((i) => [i.key, i]))}
                            selectedIndex={selectedIndex}
                            onClose={() => setTrendOpen(false)}
                        />
                    )}
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
