import React, { useState, useMemo } from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = ["#052049", "#B32A22", "#1D7044", "#B8860B", "#5A189A"];
const DEFAULT_KEYS = ["rc", "score", "trailing_pe", "roe", "mcap"];
const HL = "#B32A22";

// One hexagon: axes = companies, single parameter chosen by the user.
// Radius encodes "better for investment": companies closer to the vertex are
// more attractive. For "lower-is-better" metrics (P/E, P/B, EV/EBITDA, ratio
// venta…) the scale is inverted so the cheapest company reaches the edge.
function HexCard({ metrics, rows, defaultKey, color, idx, highlight, onHighlight }) {
    const companies = useMemo(() => rows.filter((r) => !r.error), [rows]);
    const [key, setKey] = useState(defaultKey);
    const metric = metrics.find((m) => m.key === key) || metrics[0];

    const { data, hasData } = useMemo(() => {
        const raws = companies.map((r) => {
            const v = metric.get(r);
            return (v == null || isNaN(v)) ? null : Number(v);
        });
        const valid = raws.filter((v) => v != null);
        const min = valid.length ? Math.min(...valid) : 0;
        const max = valid.length ? Math.max(...valid) : 0;
        const span = max - min;
        const invert = metric.dir === "low";
        const d = companies.map((r, i) => {
            const raw = raws[i];
            let norm = 0;
            if (raw != null) {
                if (span > 0) {
                    const p = (raw - min) / span;          // 0..1 (higher raw → 1)
                    norm = (invert ? 1 - p : p) * 90 + 10;  // near vertex = better
                } else {
                    norm = 55;
                }
            }
            return { ticker: r.ticker, value: norm, raw };
        });
        return { data: d, hasData: valid.length > 0 };
    }, [companies, metric]);

    const renderAngleTick = ({ payload, x, y, textAnchor }) => {
        const tk = payload.value;
        const isHi = highlight && tk === highlight;
        return (
            <text
                x={x} y={y} dy={4} textAnchor={textAnchor}
                onClick={() => onHighlight && onHighlight(isHi ? null : tk)}
                style={{ cursor: "pointer", fontFamily: "monospace", fontSize: isHi ? 12 : 10, fontWeight: isHi ? 700 : 400, fill: isHi ? HL : "#4A4A4A" }}
            >
                {tk}
            </text>
        );
    };

    const renderDot = ({ cx, cy, payload }) => {
        const isHi = highlight && payload.ticker === highlight;
        return <circle key={payload.ticker} cx={cx} cy={cy} r={isHi ? 5.5 : 2} fill={isHi ? HL : color} stroke="#fff" strokeWidth={isHi ? 1.5 : 0} />;
    };

    return (
        <div className="border border-black bg-white p-3 flex flex-col" data-testid={`compare-radar-${idx}`}>
            <select
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="input-paper font-mono text-xs w-full mb-2 border border-black py-1.5 px-2 bg-white"
                data-testid={`compare-radar-select-${idx}`}
            >
                {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <div className="h-[200px]">
                {hasData ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={data} outerRadius="70%">
                            <PolarGrid stroke="rgba(0,0,0,0.14)" />
                            <PolarAngleAxis dataKey="ticker" tick={renderAngleTick} />
                            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                            <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.3} strokeWidth={2} dot={renderDot} isAnimationActive={false} />
                            <Tooltip
                                formatter={(_v, _n, p) => [p.payload.raw == null ? "—" : (metric.fmt ? metric.fmt(p.payload.raw) : p.payload.raw), metric.label]}
                                contentStyle={{ border: "1px solid #111", borderRadius: 0, fontFamily: "monospace", fontSize: 12 }}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="flex items-center justify-center h-full text-xs text-[#9A9A9A] font-mono">Sin datos</div>
                )}
            </div>
        </div>
    );
}

// Below the compare table: 5 cards, each a hexagonal (multi-company) diagram of
// a single, user-selectable parameter. Click a company (chip or vertex) to
// highlight it across all five diagrams.
export const CompareRadars = ({ metrics, rows, highlight, onHighlight, testid = "compare-radars" }) => {
    if (!rows?.length || !metrics?.length) return null;
    return (
        <div className="mt-6" data-testid={testid}>
            <div className="overline text-[#B32A22] mb-1">Comparativa visual por parámetro</div>
            <div className="text-xs text-[#4A4A4A] mb-3">
                Elige un parámetro en cada hexágono. <strong>Cuanto más cerca del vértice, mejor para la inversión</strong> (p.ej. en P/E o EV/EBITDA una empresa cara queda hacia el centro). Toca una empresa para resaltarla en los cinco.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <HexCard
                        key={i}
                        idx={i}
                        metrics={metrics}
                        rows={rows}
                        highlight={highlight}
                        onHighlight={onHighlight}
                        defaultKey={DEFAULT_KEYS[i] && metrics.some((m) => m.key === DEFAULT_KEYS[i]) ? DEFAULT_KEYS[i] : metrics[i % metrics.length].key}
                        color={COLORS[i % COLORS.length]}
                    />
                ))}
            </div>
        </div>
    );
};

export default CompareRadars;
