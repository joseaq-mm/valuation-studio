import React from "react";
import HoverTip from "@/components/HoverTip";

// 0 (red) → 10 (green). Returns a hex color across a red-amber-green ramp.
function probColor(v) {
    if (v == null) return "#9CA3AF";
    const stops = [
        [0, [179, 42, 34]],    // red
        [5, [184, 134, 11]],   // amber
        [10, [30, 125, 69]],   // green
    ];
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (v >= stops[i][0] && v <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
    }
    const t = hi[0] === lo[0] ? 0 : (v - lo[0]) / (hi[0] - lo[0]);
    const c = lo[1].map((ch, i) => Math.round(ch + (hi[1][i] - ch) * t));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Probability dial 0-10 (0 rojo → 10 verde). Shows the value in a colored ring;
 * hovering reveals the AI justification.
 */
export default function ProbabilityCircle({ value, rationale, label = "Probabilidad", size = "md", testid }) {
    const color = probColor(value);
    const dim = size === "sm" ? "w-12 h-12 text-lg" : "w-16 h-16 text-2xl";
    const tip = `${label}: ${value == null ? "—" : `${value}/10`}${rationale ? `\n\n${rationale}` : ""}`;
    return (
        <HoverTip text={tip} maxWidth={300}>
            <div className="flex flex-col items-center gap-1 cursor-help" data-testid={testid}>
                <div
                    className={`${dim} rounded-full border-4 flex items-center justify-center font-mono font-bold leading-none`}
                    style={{ borderColor: color, color }}
                >
                    {value == null ? "—" : value}
                </div>
                <span className="overline text-[#4A4A4A] text-center leading-tight">{label}</span>
            </div>
        </HoverTip>
    );
}
