import React from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const Tip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0].payload;
    return (
        <div className="bg-white border border-black px-2 py-1 text-xs font-mono shadow-sm">
            <div className="font-semibold">{p.axis}</div>
            <div>{p.raw}</div>
        </div>
    );
};

/** Triangular radar (3 axes) of a company's qualitative snapshot:
 *  Score (0-100), TAM Score (escala 0→30) y Coef. KPI (escala 0,5→1,5). Cada eje 0-100. */
export function TriScore({ score, tam, coef }) {
    const data = [
        { axis: "Score", score: score == null ? 0 : clamp(score, 0, 100), raw: score == null ? "—" : score.toFixed(1) },
        { axis: "TAM", score: tam == null ? 0 : clamp((tam / 30) * 100, 0, 100), raw: tam == null ? "—" : tam.toFixed(2) },
        { axis: "Coef KPI", score: coef == null ? 0 : clamp(((coef - 0.5) / 1.0) * 100, 0, 100), raw: coef == null ? "—" : coef.toFixed(2) },
    ];
    return (
        <div className="w-full" style={{ height: 160 }} data-testid="tri-score">
            <ResponsiveContainer width="100%" height={160}>
                <RadarChart data={data} outerRadius="62%" margin={{ top: 12, right: 26, bottom: 8, left: 26 }}>
                    <PolarGrid stroke="#00000020" />
                    <PolarAngleAxis dataKey="axis" tick={{ fontFamily: "IBM Plex Mono", fontSize: 9.5, fill: "#4A4A4A" }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar dataKey="score" stroke="#B32A22" fill="#B32A22" fillOpacity={0.3} strokeWidth={1.5} isAnimationActive={false} />
                    <Tooltip content={<Tip />} />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    );
}

export default TriScore;
