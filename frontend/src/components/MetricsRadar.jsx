import React, { useMemo } from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const money = (v) => {
    if (v == null) return "—";
    const a = Math.abs(v); const s = v < 0 ? "−" : "";
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)} B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)} M`;
    return `${s}$${a.toFixed(0)}`;
};

const RadarTip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
        <div className="bg-white border border-black px-2 py-1 text-xs font-mono shadow-sm">
            <div className="font-semibold">{p.axis}</div>
            <div>{p.raw}{p.hint ? <span className="text-[#7A7A7A]"> · {p.hint}</span> : ""}</div>
        </div>
    );
};

// Two-line, vertically-centred axis labels so long ones (e.g. "Solidez (deuda)"
// on the left vertex) don't get clipped against the container edge.
const renderAxisTick = ({ payload, x, y, textAnchor }) => {
    const words = String(payload.value).split(" ");
    const lines = words.length > 1 ? [words[0], words.slice(1).join(" ")] : [String(payload.value)];
    const lineH = 10;
    const startDy = -((lines.length - 1) / 2) * lineH;
    return (
        <text x={x} y={y} textAnchor={textAnchor} fontFamily="IBM Plex Mono" fontSize={9.5} fill="#4A4A4A">
            {lines.map((ln, i) => (
                <tspan key={i} x={x} dy={i === 0 ? startDy : lineH}>{ln}</tspan>
            ))}
        </text>
    );
};

// Pentagon (radar) of the company's financial profile. Each axis is scored 0-100
// (higher = stronger). Raw values shown in the tooltip. Reads live `inputs` so it
// reflects the user's edited overrides.
export const MetricsRadar = ({ inputs }) => {
    const data = useMemo(() => {
        if (!inputs) return [];
        const { gross_margin: gm, operating_margin: om, revenue_cagr_4y: rc, fcf_cagr_4y: fc, net_debt: nd, market_cap: mc } = inputs;
        const ndRatio = (nd != null && mc) ? nd / mc : null;
        const ndScore = ndRatio == null ? 0 : clamp((0.5 - ndRatio) / 0.5 * 100, 0, 100);
        return [
            { axis: "CAGR ingresos", score: rc == null ? 0 : clamp(rc / 0.30 * 100, 0, 100), raw: pct(rc), hint: "escala 0→30%" },
            { axis: "CAGR FCF", score: fc == null ? 0 : clamp(fc / 0.30 * 100, 0, 100), raw: pct(fc), hint: "escala 0→30%" },
            { axis: "Margen bruto", score: gm == null ? 0 : clamp(gm * 100, 0, 100), raw: pct(gm), hint: "escala 0→100%" },
            { axis: "Margen operativo", score: om == null ? 0 : clamp(om / 0.40 * 100, 0, 100), raw: pct(om), hint: "escala 0→40%" },
            { axis: "Solidez (deuda)", score: ndScore, raw: money(nd), hint: ndRatio == null ? "" : `deuda/mcap ${(ndRatio * 100).toFixed(0)}%` },
        ];
    }, [inputs]);

    if (!data.length) return null;

    return (
        <div className="w-full h-full flex flex-col" data-testid="metrics-radar">
            <div className="overline text-[#4A4A4A]">Perfil financiero</div>
            <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={data} outerRadius="65%" margin={{ top: 14, right: 34, bottom: 10, left: 34 }}>
                        <PolarGrid stroke="#00000020" />
                        <PolarAngleAxis dataKey="axis" tick={renderAxisTick} />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar dataKey="score" stroke="#052049" fill="#052049" fillOpacity={0.35} strokeWidth={1.5} isAnimationActive={false} />
                        <Tooltip content={<RadarTip />} />
                    </RadarChart>
                </ResponsiveContainer>
            </div>
            <div className="text-[10px] text-[#7A7A7A] italic mt-1">Cada eje 0-100 (mayor = mejor). Pasa el cursor para ver el valor real.</div>
        </div>
    );
};

export default MetricsRadar;
