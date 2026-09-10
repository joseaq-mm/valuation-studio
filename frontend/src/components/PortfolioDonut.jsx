import React, { useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { brandColor } from "@/lib/brandColors";
import { fmtPrice } from "@/lib/format";

// Generic allocation donut used by Nivel 1 (by company and by sector).
// `items` = [{ key, label, value, companies? }] already expressed in `currency`.
// `companies` (optional — sector mode) = [{ key, label, value }], the holdings that
// make up that slice; when present the row becomes clickable and expands into a
// breakdown of those companies with their % of the slice.
// `columns` sets the legend grid (2 for the company donut, 1 for sector).
// `blur` blurs the monetary total (privacy toggle from the header).
export const PortfolioDonut = ({ items, currency = "USD", title = "Composición de la cartera", testid = "portfolio-donut", blur = false, columns = 1 }) => {
    const [expanded, setExpanded] = useState(new Set());
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

    return (
        <div className="border border-black bg-white p-4" data-testid={testid}>
            <div className="overline text-[#B32A22] mb-3">{title}</div>
            <div className="flex flex-col items-center gap-4">
                <div className="relative w-[300px] h-[300px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
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
                            >
                                {data.map((d) => <Cell key={d.key} fill={d.color} />)}
                            </Pie>
                            <Tooltip
                                formatter={(v, _n, p) => [`${p.payload.pct.toFixed(1)}%`, p.payload.label]}
                                contentStyle={{ border: "1px solid #111", borderRadius: 0, fontFamily: "monospace", fontSize: 12 }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="overline text-[9px] text-[#9A9A9A]">Total</div>
                        <div className={`font-mono text-sm ${blur ? "blur-sm select-none" : ""}`}>{fmtPrice(total, currency)}</div>
                    </div>
                </div>
                <div
                    className={`w-full grid gap-y-1.5 ${columns === 2 ? "grid-cols-1 sm:grid-cols-2 gap-x-6" : "grid-cols-1"}`}
                    data-testid={`${testid}-legend`}
                >
                    {data.map((d) => {
                        const hasCompanies = Array.isArray(d.companies) && d.companies.length > 0;
                        const isOpen = expanded.has(d.key);
                        const subTotal = hasCompanies ? d.companies.reduce((s, c) => s + c.value, 0) : 0;
                        return (
                            <div key={d.key} data-testid={`${testid}-item-${d.key}`}>
                                <div
                                    className={`flex items-center gap-2 text-sm font-mono ${hasCompanies ? "cursor-pointer select-none" : ""}`}
                                    onClick={hasCompanies ? () => toggle(d.key) : undefined}
                                >
                                    {hasCompanies ? (
                                        isOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
                                    ) : null}
                                    <span className="inline-block w-3 h-3 border border-black shrink-0" style={{ background: d.color }} />
                                    <span className="font-bold flex-1 truncate">{d.label}</span>
                                    <span className="text-right">{d.pct.toFixed(1)}%</span>
                                </div>
                                {hasCompanies && isOpen && (
                                    <div className="ml-5 mt-1 mb-1.5 space-y-1" data-testid={`${testid}-item-${d.key}-breakdown`}>
                                        {d.companies.slice().sort((a, b) => b.value - a.value).map((c) => (
                                            <div key={c.key} className="flex items-center gap-2 text-xs font-mono text-[#4A4A4A]">
                                                <span className="flex-1 truncate">{c.label}</span>
                                                <span className="text-right">{subTotal > 0 ? ((c.value / subTotal) * 100).toFixed(1) : "0.0"}%</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default PortfolioDonut;
