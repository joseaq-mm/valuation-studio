import React, { useState } from "react";
import { compare } from "@/lib/api";
import { fmtPrice, fmtPct, fmtNum, ratioColor, signalLabel } from "@/lib/format";
import { getWatchlist } from "@/lib/storage";
import { X, Plus } from "lucide-react";
import { toast } from "sonner";

export default function Compare() {
    const [input, setInput] = useState("");
    const [tickers, setTickers] = useState([]);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);

    const add = (t) => {
        const sym = t.trim().toUpperCase();
        if (!sym || tickers.includes(sym)) return;
        if (tickers.length >= 6) { toast.error("Máximo 6 empresas"); return; }
        setTickers([...tickers, sym]);
        setInput("");
    };

    const remove = (t) => {
        setTickers(tickers.filter(x => x !== t));
        setRows(rows.filter(r => r.ticker !== t));
    };

    const loadAll = async () => {
        if (!tickers.length) return;
        setLoading(true);
        try {
            const r = await compare(tickers);
            setRows(r.results || []);
        } catch { toast.error("Error al comparar"); }
        finally { setLoading(false); }
    };

    const loadFromWl = () => {
        const wl = getWatchlist().slice(0, 6);
        setTickers(wl);
    };

    const metricRows = [
        { label: "Precio", get: r => fmtPrice(r.current_price, r.currency), align: "right" },
        { label: "Market Cap", get: r => fmtNum(r.market_cap), align: "right" },
        { label: "Currency", get: r => r.currency || "—", align: "center" },
        { label: "Ratio Compra", get: r => {
            const v = r.custom_ratios?.ratio_compra_pct;
            return v == null ? "—" : (
                <span style={{ color: ratioColor(v) }}>{(v > 0 ? "+" : "") + v.toFixed(1) + "%"}</span>
            );
        }, align: "right" },
        { label: "Ratio Venta", get: r => {
            const v = r.custom_ratios?.ratio_venta_pct;
            return v == null ? "—" : (
                <span style={{ color: ratioColor(v) }}>{(v > 0 ? "+" : "") + v.toFixed(1) + "%"}</span>
            );
        }, align: "right" },
        { label: "Señal", get: r => {
            const v = r.custom_ratios?.ratio_compra_pct;
            return <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(v) }}>{signalLabel(v)}</span>;
        }, align: "center" },
        { label: "Trailing P/E", get: r => fmtNum(r.classic_ratios?.trailing_pe), align: "right" },
        { label: "Forward P/E", get: r => fmtNum(r.classic_ratios?.forward_pe), align: "right" },
        { label: "P/B", get: r => fmtNum(r.classic_ratios?.price_to_book), align: "right" },
        { label: "EV/EBITDA", get: r => fmtNum(r.classic_ratios?.ev_to_ebitda), align: "right" },
        { label: "ROE", get: r => fmtPct(r.classic_ratios?.roe), align: "right" },
        { label: "Profit margin", get: r => fmtPct(r.classic_ratios?.profit_margin), align: "right" },
        { label: "Gross margin", get: r => fmtPct(r.gross_margin), align: "right" },
        { label: "Operating margin", get: r => fmtPct(r.operating_margin), align: "right" },
        { label: "Dividend yield", get: r => fmtPct(r.classic_ratios?.dividend_yield), align: "right" },
    ];

    return (
        <div data-testid="compare-page">
            <div className="mb-6">
                <div className="overline text-[#B32A22]">Side-by-side</div>
                <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">Comparar empresas</h1>
            </div>

            <div className="border border-black bg-white p-4 mb-6" data-testid="compare-toolbar">
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex border border-black">
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value.toUpperCase())}
                            onKeyDown={(e) => { if (e.key === "Enter") add(input); }}
                            placeholder="Añadir ticker"
                            className="px-3 py-2 outline-none font-mono text-sm"
                            data-testid="compare-input"
                        />
                        <button onClick={() => add(input)} className="btn-primary !py-2" data-testid="compare-add"><Plus size={14} /></button>
                    </div>
                    <button onClick={loadFromWl} className="btn-ghost" data-testid="compare-from-watchlist">Cargar watchlist</button>
                    <button onClick={loadAll} className="btn-primary" disabled={!tickers.length || loading} data-testid="compare-load">
                        {loading ? "Cargando…" : "Comparar"}
                    </button>
                </div>
                {tickers.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                        {tickers.map(t => (
                            <span key={t} className="font-mono text-sm border border-black px-2 py-1 flex items-center gap-2" data-testid={`chip-${t}`}>
                                {t}
                                <button onClick={() => remove(t)} className="text-[#B32A22]"><X size={12} /></button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {rows.length > 0 && (
                <div className="border border-black bg-white overflow-x-auto" data-testid="compare-table">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-black">
                                <th className="overline text-left px-4 py-3 sticky left-0 bg-white">Métrica</th>
                                {rows.map(r => (
                                    <th key={r.ticker} className="overline text-right px-4 py-3 border-l border-black/20">
                                        <div className="font-mono text-base text-black">{r.ticker}</div>
                                        <div className="font-sans text-[10px] text-[#4A4A4A] normal-case tracking-normal mt-1">{r.name}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {metricRows.map(m => (
                                <tr key={m.label} className="border-b border-black/10 hover:bg-[#F5E4D4]">
                                    <td className="px-4 py-2 text-[#4A4A4A] sticky left-0 bg-white">{m.label}</td>
                                    {rows.map(r => (
                                        <td key={r.ticker} className={`px-4 py-2 font-mono text-${m.align} border-l border-black/10`}>
                                            {r.error ? <span className="text-[#B32A22] text-xs">err</span> : m.get(r)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
