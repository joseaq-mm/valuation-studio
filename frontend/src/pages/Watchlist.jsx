import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getWatchlist, getWatchlistTickers, removeFromWatchlist } from "@/lib/storage";
import { compare } from "@/lib/api";
import { computeCustomRatios, autoInputsFromData } from "@/lib/customRatios";
import { fmtPrice, fmtNum, fmtPctSigned, ratioColor, signalLabel } from "@/lib/format";
import { useThresholds } from "@/lib/useThresholds";
import { Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

/**
 * For each watchlist entry, fetch fresh Yahoo data and apply the user's saved
 * overrides (if any) before recomputing the custom ratios on the client side.
 * Price is always taken from Yahoo (current_price never overridden).
 */
const applyEntryOverrides = (companyData, entry) => {
    if (!companyData || companyData.error) return companyData;
    if (!entry || !entry.overrides || Object.keys(entry.overrides).length === 0) return companyData;

    const auto = autoInputsFromData(companyData);
    const merged = { ...auto };
    for (const [k, v] of Object.entries(entry.overrides)) {
        if (k === "current_price") continue; // never override price
        merged[k] = v;
    }
    const cr = computeCustomRatios(merged);
    return { ...companyData, custom_ratios: cr };
};

export default function Watchlist() {
    const [entries, setEntries] = useState([]);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    useThresholds(); // re-render on threshold changes

    const load = async (es) => {
        if (!es.length) { setRows([]); return; }
        setLoading(true);
        try {
            const tickers = es.map(e => e.ticker);
            const r = await compare(tickers);
            const byTicker = Object.fromEntries((r.results || []).map(x => [x.ticker, x]));
            const result = es.map(entry => {
                const cd = byTicker[entry.ticker] || { ticker: entry.ticker, error: "Sin datos" };
                return { entry, data: applyEntryOverrides(cd, entry) };
            });
            setRows(result);
        } catch (e) { toast.error("Error cargando watchlist"); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        const es = getWatchlist();
        setEntries(es);
        load(es);
    }, []);

    const handleRemove = (t) => {
        const list = removeFromWatchlist(t);
        setEntries(list);
        setRows(rows.filter(r => r.entry.ticker !== t));
        toast("Quitada");
    };

    return (
        <div data-testid="watchlist-page">
            <div className="flex justify-between items-end mb-6">
                <div>
                    <div className="overline text-[#B32A22]">Tu cartera de seguimiento</div>
                    <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">Watchlist</h1>
                </div>
                <Link to="/compare" className="btn-ghost" data-testid="watchlist-to-compare">Comparar todas <ArrowRight size={12} className="inline ml-1" /></Link>
            </div>

            {!entries.length ? (
                <div className="border border-black bg-white p-12 text-center" data-testid="watchlist-empty">
                    <div className="font-serif text-3xl mb-2">Aún no hay empresas guardadas</div>
                    <div className="text-sm text-[#4A4A4A] mb-6">Busca un ticker arriba y guarda empresas con el botón ★</div>
                    <Link to="/" className="btn-primary">Empezar</Link>
                </div>
            ) : (
                <div className="border border-black bg-white overflow-x-auto" data-testid="watchlist-table">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-black">
                                <th className="overline text-left px-4 py-3">Ticker</th>
                                <th className="overline text-left px-4 py-3">Empresa</th>
                                <th className="overline text-center px-4 py-3">Modo</th>
                                <th className="overline text-right px-4 py-3">Precio</th>
                                <th className="overline text-right px-4 py-3">Mcap</th>
                                <th className="overline text-right px-4 py-3">R. Compra</th>
                                <th className="overline text-right px-4 py-3">R. Venta</th>
                                <th className="overline text-center px-4 py-3">Señal</th>
                                <th className="px-4 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan="9" className="px-4 py-6 text-center font-mono text-[#4A4A4A]">Cargando…</td></tr>}
                            {rows.map(({ entry, data: r }) => {
                                if (r.error) return (
                                    <tr key={r.ticker} className="border-b border-black/10">
                                        <td className="px-4 py-3 font-mono">{r.ticker}</td>
                                        <td colSpan="7" className="px-4 py-3 text-[#B32A22] text-xs">{r.error}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => handleRemove(r.ticker)} data-testid={`remove-${r.ticker}`}><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                );
                                const cr = r.custom_ratios || {};
                                const isManual = entry.mode === "manual";
                                return (
                                    <tr key={r.ticker} className="border-b border-black/10 hover:bg-[#F5E4D4]" data-testid={`watchlist-row-${r.ticker}`}>
                                        <td className="px-4 py-3 font-mono font-semibold">
                                            <Link to={`/company/${r.ticker}`} className="underline-offset-2 hover:underline">{r.ticker}</Link>
                                        </td>
                                        <td className="px-4 py-3 text-[#4A4A4A]">{r.name}</td>
                                        <td className="px-4 py-3 text-center">
                                            {isManual ? (
                                                <span className="overline px-2 py-1 border border-[#1D7044] text-[#1D7044] bg-white" data-testid={`mode-${r.ticker}`}>MANUAL</span>
                                            ) : (
                                                <span className="overline px-2 py-1 border border-black/30 text-[#4A4A4A] bg-white" data-testid={`mode-${r.ticker}`}>AUTO</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">{fmtPrice(r.current_price, r.currency)}</td>
                                        <td className="px-4 py-3 text-right font-mono">{fmtNum(r.market_cap)}</td>
                                        <td className="px-4 py-3 text-right font-mono" style={{ color: ratioColor(cr.ratio_compra_pct) }} data-testid={`rc-${r.ticker}`}>
                                            {fmtPctSigned(cr.ratio_compra_pct)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono" style={{ color: ratioColor(cr.ratio_venta_pct, "venta") }} data-testid={`rv-${r.ticker}`}>
                                            {fmtPctSigned(cr.ratio_venta_pct)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(cr.ratio_compra_pct) }}>
                                                {signalLabel(cr.ratio_compra_pct)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => handleRemove(r.ticker)} className="text-[#B32A22] hover:text-black" data-testid={`remove-${r.ticker}`}>
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
