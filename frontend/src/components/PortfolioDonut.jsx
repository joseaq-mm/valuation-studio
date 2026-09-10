import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PieChart, Pie, Cell, Sector, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { brandColor } from "@/lib/brandColors";
import { fmtPrice } from "@/lib/format";

// Blends a hex color toward white — used for the glossy-highlight stop of each slice's
// gradient (a faux-3D sheen, purely a fill/shadow trick — never touches geometry, so it
// can't desync from where Recharts thinks the mouse is, unlike a real perspective tilt).
const lighten = (hex, amt = 0.45) => {
    const h = (hex || "#000000").replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const num = parseInt(full, 16) || 0;
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    const mix = (c) => Math.round(c + (255 - c) * amt);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
};
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "-");

// Hovered slice pops toward the viewer: the whole wedge shifts outward as one piece
// along its own bisector angle (the classic "exploded slice" offset — cx/cy move, not
// just one edge) AND grows a little thicker, with a cast shadow reinforcing the lift.
// Recharts animates both the position and radius change on its own.
const RADIAN = Math.PI / 180;
const HOVER_SHIFT = 10;
const HOVER_GROW = 6;
const renderActiveSlice = (props) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    const dx = Math.cos(-midAngle * RADIAN) * HOVER_SHIFT;
    const dy = Math.sin(-midAngle * RADIAN) * HOVER_SHIFT;
    return (
        <Sector
            cx={cx + dx} cy={cy + dy}
            innerRadius={innerRadius}
            outerRadius={outerRadius + HOVER_GROW}
            startAngle={startAngle}
            endAngle={endAngle}
            fill={fill}
            stroke="#111"
            strokeWidth={1}
            style={{ filter: "drop-shadow(0px 5px 7px rgba(0,0,0,0.4))" }}
        />
    );
};

// `linkTickers`: the top-level rows are tickers (company donut) rather than sector
// names, so the label links to the company's ficha (/company/{ticker}). The nested
// per-company breakdown (sector donut, expanded) is always tickers regardless, so it
// always links.
const LegendRow = ({ d, expanded, toggle, testid, linkTickers = false }) => {
    const hasCompanies = Array.isArray(d.companies) && d.companies.length > 0;
    const isOpen = expanded.has(d.key);
    const subTotal = hasCompanies ? d.companies.reduce((s, c) => s + c.value, 0) : 0;
    return (
        <div data-testid={`${testid}-item-${d.key}`}>
            <div
                className={`flex items-center gap-2 text-sm font-mono ${hasCompanies ? "cursor-pointer select-none" : ""}`}
                onClick={hasCompanies ? () => toggle(d.key) : undefined}
            >
                {hasCompanies ? (
                    isOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
                ) : null}
                <span className="inline-block w-3 h-3 border border-black shrink-0" style={{ background: d.color }} />
                {linkTickers ? (
                    <Link to={`/company/${d.key}`} className="font-bold flex-1 truncate hover:underline" onClick={(e) => e.stopPropagation()}>
                        {d.label}
                    </Link>
                ) : (
                    <span className="font-bold flex-1 truncate">{d.label}</span>
                )}
                <span className="text-right">{d.pct.toFixed(1)}%</span>
            </div>
            {hasCompanies && isOpen && (
                <div className="ml-5 mt-1 mb-1.5 space-y-1" data-testid={`${testid}-item-${d.key}-breakdown`}>
                    {d.companies.slice().sort((a, b) => b.value - a.value).map((c) => (
                        <div key={c.key} className="flex items-center gap-2 text-xs font-mono text-[#4A4A4A]">
                            <Link to={`/company/${c.key}`} className="flex-1 truncate hover:underline">{c.label}</Link>
                            <span className="text-right">{subTotal > 0 ? ((c.value / subTotal) * 100).toFixed(1) : "0.0"}%</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// Generic allocation donut used by Nivel 1 (by company and by sector).
// `items` = [{ key, label, value, companies? }] already expressed in `currency`.
// `companies` (optional — sector mode) = [{ key, label, value }], the holdings that
// make up that slice; when present the row becomes clickable and expands into a
// breakdown of those companies with their % of the slice.
// `columns` sets the legend layout: 2 splits the ranked list column-major (heaviest
// half top-to-bottom on the left, lightest half top-to-bottom on the right — read a
// full column before moving to the next, not row by row); 1 is a single column.
// `blur` blurs the monetary total (privacy toggle from the header).
// `linkTickers`: top-level rows are tickers (company donut) and should link to their
// ficha — leave false for the sector donut, whose top-level rows are sector names.
export const PortfolioDonut = ({ items, currency = "USD", title = "Composición de la cartera", testid = "portfolio-donut", blur = false, columns = 1, linkTickers = false }) => {
    const [expanded, setExpanded] = useState(new Set());
    const [activeIndex, setActiveIndex] = useState(undefined);
    const data = useMemo(() => {
        const clean = (items || []).filter((i) => i.value != null && i.value > 0);
        const total = clean.reduce((s, i) => s + i.value, 0);
        return clean
            .map((i) => ({ ...i, pct: total > 0 ? (i.value / total) * 100 : 0, color: brandColor(i.key) }))
            .sort((a, b) => b.value - a.value);
    }, [items]);

    if (data.length < 1) return null;
    const total = data.reduce((s, i) => s + i.value, 0);
    const toggle = (key) => setExpanded((s) => {
        const n = new Set(s);
        n.has(key) ? n.delete(key) : n.add(key);
        return n;
    });

    const useColumns = columns === 2 && data.length > 1;
    const splitAt = Math.ceil(data.length / 2);
    const colLeft = useColumns ? data.slice(0, splitAt) : data;
    const colRight = useColumns ? data.slice(splitAt) : [];

    return (
        <div className="border border-black bg-white p-4" data-testid={testid}>
            <div className="overline text-[#B32A22] mb-3">{title}</div>
            <div className="flex flex-col items-center gap-4">
                <div className="relative w-[300px] h-[300px] shrink-0">
                    {/* Painted BEFORE the chart in the DOM (same stacking context, no
                        z-index on either) so the chart — and its hover tooltip, which
                        can land right over the ring's center — always renders on top of
                        this label instead of the label bleeding through it. */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="overline text-[9px] text-[#9A9A9A]">Total</div>
                        <div className={`font-mono text-sm ${blur ? "blur-sm select-none" : ""}`}>{fmtPrice(total, currency)}</div>
                    </div>
                    {/* Shadow scoped to just the chart (not the Total label above) so the
                        ring reads as a raised disc without a real perspective tilt — that
                        would desync Recharts' hover math from what's visually under the
                        cursor, so we fake the depth purely with fill/shadow instead. */}
                    <div style={{ width: "100%", height: "100%", filter: "drop-shadow(0px 10px 16px rgba(0,0,0,0.28))" }}>
                        <ResponsiveContainer width="100%" height="100%">
                            {/* overflow: visible — the SVG clips anything drawn past its own
                                canvas by default, which cut off the hovered slice (and its
                                shadow) right at the edge once it grew/shifted past the
                                ring's resting size. */}
                            <PieChart style={{ overflow: "visible" }}>
                                <defs>
                                    {data.map((d) => (
                                        <radialGradient key={d.key} id={`${safeId(testid)}-grad-${safeId(d.key)}`} cx="35%" cy="30%" r="75%">
                                            <stop offset="0%" stopColor={lighten(d.color)} />
                                            <stop offset="100%" stopColor={d.color} />
                                        </radialGradient>
                                    ))}
                                </defs>
                                <Pie
                                    data={data}
                                    dataKey="value"
                                    nameKey="label"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={84}
                                    outerRadius={138}
                                    paddingAngle={data.length > 1 ? 2 : 0}
                                    stroke="#111"
                                    strokeWidth={1}
                                    activeIndex={activeIndex}
                                    activeShape={renderActiveSlice}
                                    onMouseEnter={(_, index) => setActiveIndex(index)}
                                    onMouseLeave={() => setActiveIndex(undefined)}
                                >
                                    {data.map((d) => <Cell key={d.key} fill={`url(#${safeId(testid)}-grad-${safeId(d.key)})`} />)}
                                </Pie>
                                <Tooltip
                                    formatter={(v, _n, p) => [`${p.payload.pct.toFixed(1)}%`, p.payload.label]}
                                    wrapperStyle={{ zIndex: 30 }}
                                    contentStyle={{
                                        background: "#111111", opacity: 1, border: "1px solid #111",
                                        borderRadius: 0, fontFamily: "monospace", fontSize: 12,
                                    }}
                                    labelStyle={{ color: "#fff" }}
                                    itemStyle={{ color: "#fff" }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                {useColumns ? (
                    <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-x-6" data-testid={`${testid}-legend`}>
                        <div className="grid grid-cols-1 gap-y-1.5">
                            {colLeft.map((d) => <LegendRow key={d.key} d={d} expanded={expanded} toggle={toggle} testid={testid} linkTickers={linkTickers} />)}
                        </div>
                        <div className="grid grid-cols-1 gap-y-1.5">
                            {colRight.map((d) => <LegendRow key={d.key} d={d} expanded={expanded} toggle={toggle} testid={testid} linkTickers={linkTickers} />)}
                        </div>
                    </div>
                ) : (
                    <div className="w-full grid grid-cols-1 gap-y-1.5" data-testid={`${testid}-legend`}>
                        {data.map((d) => <LegendRow key={d.key} d={d} expanded={expanded} toggle={toggle} testid={testid} linkTickers={linkTickers} />)}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PortfolioDonut;
