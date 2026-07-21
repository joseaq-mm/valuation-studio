import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { compare, thesisVisualData } from "@/lib/api";
import { fmtPrice, fmtPct, fmtNum, fmtPctSigned, ratioColor, signalLabel } from "@/lib/format";
import { useThresholds } from "@/lib/useThresholds";
import { useFx } from "@/lib/fx";
import { useI18n } from "@/lib/i18n";
import { getWatchlistTickers } from "@/lib/storage";
import { getPortfolio } from "@/lib/portfolio";
import TickerAutocomplete from "@/components/TickerAutocomplete";
import { CompareRadars } from "@/components/CompareRadars";
import HoverTip from "@/components/HoverTip";
import { X } from "lucide-react";
import { toast } from "sonner";

export default function Compare() {
    const [input, setInput] = useState("");
    const [tickers, setTickers] = useState([]);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [qual, setQual] = useState({});  // ticker → { score, tam, kpi_coef }
    const [highlight, setHighlight] = useState(null);  // ticker highlighted across radars
    const { display: displayCur, convert: fxConvert } = useFx();
    const { t } = useI18n();
    useThresholds();

    // Qualitative layer (score / TAM / coef KPI) from the user's theses, by ticker.
    useEffect(() => {
        thesisVisualData()
            .then((d) => {
                const m = {};
                (d.rows || []).forEach((r) => { m[r.ticker] = { score: r.avg_overall_score, tam: r.sum_tam_score, kpi_coef: r.kpi_coef }; });
                setQual(m);
            })
            .catch(() => setQual({}));
    }, []);

    // Restore the last comparison (tickers + fetched rows + highlight) so returning
    // to this page from a company detail keeps everything loaded — no re-fetch.
    useEffect(() => {
        try {
            const saved = JSON.parse(sessionStorage.getItem("vs:compare-state") || "null");
            if (saved && Array.isArray(saved.tickers) && saved.tickers.length) {
                setTickers(saved.tickers);
                if (Array.isArray(saved.rows)) setRows(saved.rows);
                if (saved.highlight) setHighlight(saved.highlight);
            }
        } catch { /* ignore */ }
    }, []);

    // Persist comparison state on every change.
    useEffect(() => {
        try {
            if (tickers.length || rows.length) {
                sessionStorage.setItem("vs:compare-state", JSON.stringify({ tickers, rows, highlight }));
            } else {
                sessionStorage.removeItem("vs:compare-state");
            }
        } catch { /* ignore */ }
    }, [tickers, rows, highlight]);

    const useDisplay = displayCur && displayCur !== "NATIVE";
    const convPrice = (r) => useDisplay ? fxConvert(r.current_price, r.currency) : r.current_price;
    const convMcap = (r) => useDisplay ? fxConvert(r.market_cap, r.currency) : r.market_cap;
    const displayCurFor = (r) => useDisplay ? displayCur : r.currency;

    const add = (sym) => {
        const s = (sym || "").trim().toUpperCase();
        if (!s || tickers.includes(s)) return;
        if (tickers.length >= 6) { toast.error(t("compare.max_companies")); return; }
        setTickers([...tickers, s]);
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
        const wl = getWatchlistTickers().slice(0, 6);
        if (!wl.length) { toast.message("No tienes acciones en Nivel 2"); return; }
        setTickers(wl);
    };

    const loadFromPf = () => {
        const pf = getPortfolio().map(p => p.ticker).slice(0, 6);
        if (!pf.length) { toast.message("No tienes acciones en Nivel 1"); return; }
        setTickers(pf);
    };

    const metricRows = [
        { label: t("compare.row_price"), get: r => fmtPrice(convPrice(r), displayCurFor(r)), align: "right" },
        { label: t("compare.row_poc"), get: r => {
            const v = r.custom_ratios?.poc;
            if (v == null) return "—";
            const conv = useDisplay ? fxConvert(v, r.currency) : v;
            return <span style={{ color: ratioColor(r.custom_ratios?.ratio_compra_pct, "compra") }}>{fmtPrice(conv, displayCurFor(r))}</span>;
        }, align: "right" },
        { label: t("compare.row_pov"), get: r => {
            const v = r.custom_ratios?.pov;
            if (v == null) return "—";
            const conv = useDisplay ? fxConvert(v, r.currency) : v;
            return <span style={{ color: ratioColor(r.custom_ratios?.ratio_venta_pct, "venta") }}>{fmtPrice(conv, displayCurFor(r))}</span>;
        }, align: "right" },
        { label: t("compare.row_mcap"), get: r => fmtNum(convMcap(r)), align: "right" },
        { label: t("compare.row_currency"), get: r => useDisplay ? `${r.currency} → ${displayCur}` : (r.currency || "—"), align: "center" },
        { label: t("company.ratio_compra"), get: r => {
            const v = r.custom_ratios?.ratio_compra_pct;
            return v == null ? "—" : (
                <span style={{ color: ratioColor(v) }}>{fmtPctSigned(v)}</span>
            );
        }, align: "right" },
        { label: t("company.ratio_venta"), get: r => {
            const v = r.custom_ratios?.ratio_venta_pct;
            return v == null ? "—" : (
                <span style={{ color: ratioColor(v, "venta") }}>{fmtPctSigned(v)}</span>
            );
        }, align: "right" },
        { label: t("compare.row_signal"), get: r => {
            const v = r.custom_ratios?.ratio_compra_pct;
            return <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(v) }}>{signalLabel(v)}</span>;
        }, align: "center" },
        { label: t("compare.row_score"), get: r => {
            const v = qual[r.ticker]?.score;
            return v == null ? "—" : <span style={{ color: v >= 70 ? "#1D7044" : v >= 50 ? "#B8860B" : "#B32A22" }}>{Number(v).toFixed(1)}</span>;
        }, align: "right" },
        { label: t("compare.row_tam"), get: r => {
            const v = qual[r.ticker]?.tam;
            return v == null ? "—" : Number(v).toFixed(2);
        }, align: "right" },
        { label: t("compare.row_kpi"), get: r => {
            const v = qual[r.ticker]?.kpi_coef;
            return v == null ? "—" : <span style={{ color: v > 1.05 ? "#1D7044" : v < 0.95 ? "#B32A22" : "#B8860B", fontWeight: 600 }}>{Number(v).toFixed(2)}</span>;
        }, align: "right" },
        { label: "Trailing P/E", get: r => fmtNum(r.classic_ratios?.trailing_pe), align: "right" },
        { label: "Forward P/E", get: r => fmtNum(r.classic_ratios?.forward_pe), align: "right" },
        { label: "P/B", get: r => fmtNum(r.classic_ratios?.price_to_book), align: "right" },
        { label: "EV/EBITDA", get: r => fmtNum(r.classic_ratios?.ev_to_ebitda), align: "right" },
        { label: "ROE", get: r => fmtPct(r.classic_ratios?.roe), align: "right" },
        { label: "ROA", get: r => fmtPct(r.classic_ratios?.roa), align: "right" },
        { label: "ROIC", get: r => fmtPct(r.classic_ratios?.roic), align: "right" },
        { label: "ROCE", get: r => fmtPct(r.classic_ratios?.roce), align: "right" },
        { label: "Profit margin", get: r => fmtPct(r.classic_ratios?.profit_margin), align: "right" },
        { label: "Gross margin", get: r => fmtPct(r.gross_margin), align: "right" },
        { label: "Operating margin", get: r => fmtPct(r.operating_margin), align: "right" },
        { label: "Dividend yield", get: r => fmtPct(r.classic_ratios?.dividend_yield), align: "right" },
    ];

    // Raw numeric parameters for the hexagonal radars (below the table).
    // dir: "high" = higher is better (closer to vertex), "low" = lower is better
    // (inverted so cheap/attractive reaches the edge), "neutral" = magnitude only.
    const radarMetrics = [
        { key: "price", label: "Precio", get: r => convPrice(r), fmt: v => fmtPrice(v, useDisplay ? displayCur : ""), dir: "neutral" },
        { key: "mcap", label: "Capitalización", get: r => convMcap(r), fmt: v => fmtNum(v), dir: "neutral" },
        { key: "rc", label: "Ratio Compra %", get: r => r.custom_ratios?.ratio_compra_pct, fmt: v => fmtPctSigned(v), dir: "high" },
        { key: "rv", label: "Ratio Venta %", get: r => r.custom_ratios?.ratio_venta_pct, fmt: v => fmtPctSigned(v), dir: "low" },
        { key: "score", label: "Score", get: r => qual[r.ticker]?.score, fmt: v => Number(v).toFixed(1), dir: "high" },
        { key: "tam", label: "TAM", get: r => qual[r.ticker]?.tam, fmt: v => Number(v).toFixed(2), dir: "high" },
        { key: "kpi", label: "Coef KPI", get: r => qual[r.ticker]?.kpi_coef, fmt: v => Number(v).toFixed(2), dir: "high" },
        { key: "trailing_pe", label: "Trailing P/E", get: r => r.classic_ratios?.trailing_pe, fmt: v => fmtNum(v), dir: "low" },
        { key: "forward_pe", label: "Forward P/E", get: r => r.classic_ratios?.forward_pe, fmt: v => fmtNum(v), dir: "low" },
        { key: "pb", label: "P/B", get: r => r.classic_ratios?.price_to_book, fmt: v => fmtNum(v), dir: "low" },
        { key: "ev_ebitda", label: "EV/EBITDA", get: r => r.classic_ratios?.ev_to_ebitda, fmt: v => fmtNum(v), dir: "low" },
        { key: "roe", label: "ROE", get: r => r.classic_ratios?.roe, fmt: v => fmtPct(v), dir: "high" },
        { key: "roa", label: "ROA", get: r => r.classic_ratios?.roa, fmt: v => fmtPct(v), dir: "high" },
        { key: "roic", label: "ROIC", get: r => r.classic_ratios?.roic, fmt: v => fmtPct(v), dir: "high" },
        { key: "roce", label: "ROCE", get: r => r.classic_ratios?.roce, fmt: v => fmtPct(v), dir: "high" },
        { key: "profit_margin", label: "Profit margin", get: r => r.classic_ratios?.profit_margin, fmt: v => fmtPct(v), dir: "high" },
        { key: "gross_margin", label: "Gross margin", get: r => r.gross_margin, fmt: v => fmtPct(v), dir: "high" },
        { key: "operating_margin", label: "Operating margin", get: r => r.operating_margin, fmt: v => fmtPct(v), dir: "high" },
        { key: "dividend_yield", label: "Dividend yield", get: r => r.classic_ratios?.dividend_yield, fmt: v => fmtPct(v), dir: "high" },
    ];

    return (
        <div data-testid="compare-page">
            <div className="mb-6">
                <div className="overline text-[#B32A22]">{t("compare.tag")}</div>
                <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">{t("compare.title")}</h1>
            </div>

            <div className="border border-black bg-white p-4 mb-6" data-testid="compare-toolbar">
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="w-72">
                        <TickerAutocomplete
                            value={input}
                            onChange={setInput}
                            onPick={(r) => add(r.symbol)}
                            placeholder={t("compare.search_placeholder")}
                            testid="compare-input"
                        />
                    </div>
                    <HoverTip text="Carga las 6 primeras acciones de tu Nivel 1 (cartera) en el comparador.">
                        <button onClick={loadFromPf} className="btn-ghost" data-testid="compare-from-portfolio">Cargar Nivel 1</button>
                    </HoverTip>
                    <HoverTip text="Carga las 6 primeras acciones de tu Nivel 2 (watchlist) en el comparador.">
                        <button onClick={loadFromWl} className="btn-ghost" data-testid="compare-from-watchlist">{t("compare.load_watchlist")}</button>
                    </HoverTip>
                    <HoverTip text="Se comparan un máximo de 6 empresas a la vez. Añade tickers y pulsa Comparar.">
                        <button onClick={loadAll} className="btn-primary" disabled={!tickers.length || loading} data-testid="compare-load">
                            {loading ? t("compare.running") : t("compare.run")}
                        </button>
                    </HoverTip>
                </div>
                {tickers.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                        {tickers.map(t => (
                            <span key={t} className={`font-mono text-sm border px-2 py-1 flex items-center gap-2 ${highlight === t ? "border-[#B32A22] bg-[#B32A22]/10" : "border-black"}`} data-testid={`chip-${t}`}>
                                <button
                                    type="button"
                                    onClick={() => setHighlight(highlight === t ? null : t)}
                                    className={highlight === t ? "text-[#B32A22] font-bold" : "hover:text-[#B32A22]"}
                                    title="Resaltar en los hexágonos"
                                    data-testid={`chip-highlight-${t}`}
                                >
                                    {t}
                                </button>
                                <button onClick={() => remove(t)} className="text-[#B32A22]" data-testid={`chip-remove-${t}`}><X size={12} /></button>
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
                                <th className="overline text-left px-4 py-3 sticky left-0 bg-white">{t("compare.metric")}</th>
                                {rows.map(r => (
                                    <th key={r.ticker} className="overline text-right px-4 py-3 border-l border-black/20">
                                        <Link to={`/company/${r.ticker}`} className="block group" data-testid={`compare-head-link-${r.ticker}`}>
                                            <div className="font-mono text-base text-black group-hover:text-[#B32A22] transition-colors">{r.ticker}</div>
                                            <div className="font-sans text-[10px] text-[#4A4A4A] normal-case tracking-normal mt-1 underline decoration-dotted underline-offset-2 group-hover:text-[#B32A22]">{r.name}</div>
                                        </Link>
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

            {rows.length > 0 && <CompareRadars metrics={radarMetrics} rows={rows} highlight={highlight} onHighlight={setHighlight} />}
        </div>
    );
}
