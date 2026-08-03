import React, { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { brandColor } from "@/lib/brandColors";
import { fmtPrice, fmtPctSigned } from "@/lib/format";

const TotalBox = ({ label, value, color, blur }) => (
    <div className="border border-black bg-white px-3 py-2">
        <div className="overline text-[#4A4A4A] text-[9px]">{label}</div>
        <div className={`font-mono text-base sm:text-lg mt-0.5 ${blur ? "blur-sm select-none" : ""}`} style={{ color: color || "var(--text-primary)" }}>{value}</div>
    </div>
);

// Ring/donut chart of the Nivel 1 portfolio composition (by current market value).
// `items` = [{ ticker, value }] already expressed in `currency`.
// `totals` = { invested, now, pl, plPct } shown above the ring.
// `blur` blurs the monetary amounts (privacy toggle from the header).
export const PortfolioDonut = ({ items, currency = "USD", testid = "portfolio-donut", totals = null, blur = false }) => {
    const data = useMemo(() => {
        const clean = (items || []).filter((i) => i.value != null && i.value > 0);
        const total = clean.reduce((s, i) => s + i.value, 0);
        return clean
            .map((i) => ({ ...i, pct: total > 0 ? (i.value / total) * 100 : 0, color: brandColor(i.ticker) }))
            .sort((a, b) => b.value - a.value);
    }, [items]);

    if (data.length < 1) return null;
    const total = data.reduce((s, i) => s + i.value, 0);
    const showTotals = totals && totals.invested > 0;

    return (
        <div className="border border-black bg-white p-4 mt-6" data-testid={testid}>
            <div className="overline text-[#B32A22] mb-3">Composición de la cartera</div>

            {showTotals && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4" data-testid={`${testid}-totals`}>
                    <TotalBox label="Invertido (compra)" value={fmtPrice(totals.invested, currency)} blur={blur} />
                    <TotalBox label="Valor total actual" value={fmtPrice(totals.now, currency)} blur={blur} />
                    <TotalBox label="P/L" value={fmtPrice(totals.pl, currency)} color={totals.pl >= 0 ? "var(--cheap)" : "var(--crimson)"} blur={blur} />
                    <TotalBox label="P/L %" value={totals.plPct == null ? "—" : fmtPctSigned(totals.plPct)} color={(totals.plPct || 0) >= 0 ? "var(--cheap)" : "var(--crimson)"} />
                </div>
            )}

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
                                formatter={(v, _n, p) => [`${p.payload.pct.toFixed(1)}%`, p.payload.ticker]}
                                contentStyle={{ border: "1px solid #111", borderRadius: 0, fontFamily: "monospace", fontSize: 12 }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="overline text-[9px] text-[#9A9A9A]">Total</div>
                        <div className={`font-mono text-sm ${blur ? "blur-sm select-none" : ""}`}>{fmtPrice(total, currency)}</div>
                    </div>
                </div>
                <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5" data-testid={`${testid}-legend`}>
                    {data.map((d) => (
                        <div key={d.ticker} className="flex items-center gap-2 text-xs font-mono" data-testid={`${testid}-item-${d.ticker}`}>
                            <span className="inline-block w-3 h-3 border border-black shrink-0" style={{ background: d.color }} />
                            <span className="font-bold flex-1 truncate">{d.ticker}</span>
                            <span className="text-right">{d.pct.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PortfolioDonut;
