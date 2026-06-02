import React from "react";

export const scoreColor = (v) => {
    if (v == null) return "#9CA3AF";
    if (v >= 75) return "#1E7D45";
    if (v >= 50) return "#B8860B";
    return "#B32A22";
};

export const tamColor = (v) => (v == null ? "#9CA3AF" : v >= 1 ? "#1E7D45" : "#B8860B");

export const fmtTamScore = (v) => {
    if (v == null || isNaN(v)) return null;
    return v.toFixed(2);
};

/** Square boxed value, matching the ScoreBadge box look. */
export function ValueBox({ text, color, testid, title }) {
    return (
        <div
            className="w-11 h-10 border-2 flex items-center justify-center font-mono text-xs font-bold shrink-0"
            style={{ borderColor: color, color }}
            data-testid={testid}
            title={title}
        >
            {text == null ? "—" : text}
        </div>
    );
}

const DIM_LABELS = {
    competitive_position: "Posición competitiva",
    sector_momentum: "Momentum del sector",
    management_quality: "Calidad del management",
    financial_resilience: "Resiliencia financiera",
};

export function ScoreBadge({ value, label, testid }) {
    const c = scoreColor(value);
    return (
        <div className="flex items-center gap-2" data-testid={testid}>
            <div
                className="w-10 h-10 border-2 flex items-center justify-center font-mono text-sm font-bold shrink-0"
                style={{ borderColor: c, color: c }}
            >
                {value == null ? "—" : value}
            </div>
            {label && <span className="overline text-[#4A4A4A] leading-tight">{label}</span>}
        </div>
    );
}

export function ScoreBar({ dimension, value }) {
    const c = scoreColor(value);
    const label = DIM_LABELS[dimension] || dimension;
    return (
        <div className="space-y-1" data-testid={`score-bar-${dimension}`}>
            <div className="flex justify-between items-center">
                <span className="text-xs text-[#4A4A4A]">{label}</span>
                <span className="font-mono text-xs font-semibold" style={{ color: c }}>
                    {value == null ? "—" : value}
                </span>
            </div>
            <div className="h-1.5 w-full bg-black/10">
                <div className="h-full transition-all" style={{ width: `${value || 0}%`, background: c }} />
            </div>
        </div>
    );
}
