import React, { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { brandColor } from "@/lib/brandColors";
import { fmtPrice } from "@/lib/format";

// Ring/donut chart of the Nivel 1 portfolio composition (by current market value).
// `items` = [{ ticker, value }] already expressed in `currency`.
export const PortfolioDonut = ({ items, currency = "USD", testid = "portfolio-donut" }) => {
    const data = useMemo(() => {
        const clean = (items || []).filter((i) => i.value != null && i.value > 0);
        const total = clean.reduce((s, i) => s + i.value, 0);
        return clean
            .map((i) => ({ ...i, pct: total > 0 ? (i.value / total) * 100 : 0, color: brandColor(i.ticker) }))
            .sort((a, b) => b.value - a.value);
    }, [items]);

    if (data.length < 1) return null;
    const total = data.reduce((s, i) => s + i.value, 0);

    return (
        <div className="border border-black bg-white p-4 mt-6" data-testid={testid}>
            <div className="overline text-[#B32A22] mb-3">Composición de la cartera</div>
            <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="relative w-[220px] h-[220px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={data}
                                dataKey="value"
                                nameKey="ticker"
                                cx="50%"
                                cy="50%"
                                innerRadius={62}
                                outerRadius={100}
                                paddingAngle={data.length > 1 ? 2 : 0}
                                stroke="#111"
                                strokeWidth={1}
                            >
                                {data.map((d) => <Cell key={d.ticker} fill={d.color} />)}
                            </Pie>
                            <Tooltip
                                formatter={(v, _n, p) => [`${fmtPrice(v, currency)} · ${p.payload.pct.toFixed(1)}%`, p.payload.ticker]}
                                contentStyle={{ border: "1px solid #111", borderRadius: 0, fontFamily: "monospace", fontSize: 12 }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="overline text-[9px] text-[#9A9A9A]">Total</div>
                        <div className="font-mono text-sm">{fmtPrice(total, currency)}</div>
                    </div>
                </div>
                <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5" data-testid={`${testid}-legend`}>
                    {data.map((d) => (
                        <div key={d.ticker} className="flex items-center gap-2 text-xs font-mono" data-testid={`${testid}-item-${d.ticker}`}>
                            <span className="inline-block w-3 h-3 border border-black shrink-0" style={{ background: d.color }} />
                            <span className="font-bold w-16 shrink-0">{d.ticker}</span>
                            <span className="w-14 text-right">{d.pct.toFixed(1)}%</span>
                            <span className="text-[#4A4A4A] flex-1 text-right">{fmtPrice(d.value, currency)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PortfolioDonut;
