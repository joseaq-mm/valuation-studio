import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { getWatchlist, getWatchlistTickers, removeFromWatchlist, setWatchlistAlert, setAllWatchlistAlerts } from "@/lib/storage";
import { compare, thesisVisualData } from "@/lib/api";
import { computeCustomRatios, autoInputsFromData } from "@/lib/customRatios";
import { fmtPrice, fmtNum, fmtPctSigned, ratioColor, signalLabel } from "@/lib/format";
import { useThresholds } from "@/lib/useThresholds";
import { useAuth } from "@/lib/auth";
import { useFx } from "@/lib/fx";
import { useI18n } from "@/lib/i18n";
import { notifyGet, notifyPut } from "@/lib/api";
import AlertToggle from "@/components/AlertToggle";
import AlertInfoBanner from "@/components/AlertInfoBanner";
import MasterAlertToggle from "@/components/MasterAlertToggle";
import HoverTip from "@/components/HoverTip";
import { ViewToggle } from "@/components/ViewToggle";
import { CompanyCard } from "@/components/CompanyCard";
import { NextEarnings, nextEarningsInfo } from "@/components/NextEarnings";
import { CardSort } from "@/components/CardSort";
import { SortableTh, makeSorter, nextSort } from "@/components/SortableTh";
import { Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const WL_NUMERIC_KEYS = new Set(["price", "mcap", "rc", "rv", "score", "tam", "kpi"]);
const WL_SORT_OPTIONS = [
    { key: "ticker", label: "Alfabético (Ticker)" },
    { key: "name", label: "Alfabético (Nombre)" },
    { key: "price", label: "Precio" },
    { key: "mcap", label: "Capitalización" },
    { key: "rc", label: "Ratio Compra" },
    { key: "rv", label: "Ratio Venta" },
    { key: "score", label: "Score" },
    { key: "tam", label: "TAM" },
    { key: "kpi", label: "Coef KPI" },
    { key: "earnings", label: "Próx. resultados" },
];
const WL_ACCESSORS = {
    ticker: (row) => row.data?.ticker,
    name: (row) => row.data?.name,
    price: (row) => row.data?.current_price,
    mcap: (row) => row.data?.market_cap,
    rc: (row) => row.data?.custom_ratios?.ratio_compra_pct,
    rv: (row) => row.data?.custom_ratios?.ratio_venta_pct,
};

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
    const [qual, setQual] = useState({});  // ticker → { score, tam, kpi_coef }
    const [loading, setLoading] = useState(false);
    const [sort, setSort] = useState(null);
    const [view, setView] = useState(() => localStorage.getItem("vs:watchlist-view") || "table");
    const changeView = (v) => { setView(v); localStorage.setItem("vs:watchlist-view", v); };
    const { user } = useAuth();
    const [notify, setNotify] = useState(null);
    const { display: displayCur, convert: fxConvert } = useFx();
    const { t } = useI18n();
    useThresholds(); // re-render on threshold changes

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

    useEffect(() => {
        if (!user) { setNotify(null); return; }
        notifyGet().then((n) => {
            // The per-row bell is now the single source of truth for activation.
            // Auto-enable the global flags silently so emails actually flow when
            // the user toggles a row bell. We only push to backend if something
            // is missing to avoid spurious writes on every mount.
            const desired = {
                enabled: true,
                cross_buy_zone: n?.cross_buy_zone !== false,
                cross_sell_zone: n?.cross_sell_zone !== false,
            };
            setNotify(desired);
            if (!n?.enabled || n?.cross_buy_zone === false || n?.cross_sell_zone === false) {
                notifyPut(desired).catch(() => { /* non-fatal */ });
            }
        }).catch(() => setNotify({ enabled: true, cross_buy_zone: true, cross_sell_zone: true }));
    }, [user]);

    // Kept for potential future preferences UI; not used by the simplified banner.
    // eslint-disable-next-line no-unused-vars
    const updateNotify = async (patch) => {
        const next = { ...(notify || {}), ...patch };
        setNotify(next);
        try { await notifyPut(next); toast.success("Preferencias guardadas"); }
        catch { toast.error("No se pudieron guardar las preferencias"); }
    };

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
        if (es.length > 100) {
            toast.warning(`Tu watchlist tiene ${es.length} tickers (límite recomendado: 100). El rendimiento puede verse afectado.`);
        }
        load(es);
        // Stay in sync with localStorage updates (e.g. per-row alert toggle,
        // master alert toggle, or adds from another page). We only refresh
        // `entries` so the master bell + counter reflect the new state;
        // `rows` keep their fresh Yahoo data and we just re-merge each entry.
        const onChange = () => {
            const next = getWatchlist();
            setEntries(next);
            setRows((prev) => prev.map(r => {
                const updated = next.find(e => e.ticker === r.entry.ticker);
                return updated ? { ...r, entry: updated } : r;
            }));
        };
        window.addEventListener("vs:watchlist-changed", onChange);
        return () => window.removeEventListener("vs:watchlist-changed", onChange);
    }, []);

    const handleRemove = (t) => {
        const list = removeFromWatchlist(t);
        setEntries(list);
        setRows(rows.filter(r => r.entry.ticker !== t));
        toast("Quitada");
    };

    const activeAlertCount = entries.filter(e => e.alert_enabled).length;
    const toggleAllAlerts = (next) => {
        if (!user) { toast.message(t("alerts.requires_login")); return; }
        if (entries.length === 0) return;
        const list = setAllWatchlistAlerts(next);
        setEntries(list);
        toast.success(next ? "Alertas activadas en toda la watchlist" : "Alertas desactivadas en toda la watchlist");
    };

    const onSort = (key) => setSort((prev) => nextSort(prev, key, WL_NUMERIC_KEYS));
    const accessors = {
        ...WL_ACCESSORS,
        score: (row) => qual[row.data?.ticker]?.score,
        tam: (row) => qual[row.data?.ticker]?.tam,
        kpi: (row) => qual[row.data?.ticker]?.kpi_coef,
        earnings: (row) => { const info = nextEarningsInfo(row.data?.next_earnings_date); return info ? info.days : null; },
    };
    const sortedRows = useMemo(() => {
        if (!sort || !accessors[sort.key]) return rows;
        return [...rows].sort(makeSorter(accessors[sort.key], sort.dir));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows, sort, qual]);

    return (
        <div data-testid="watchlist-page">
            <div className="flex justify-between items-end mb-6">
                <div>
                    <div className="overline text-[#B32A22]">{t("watchlist.tag")}</div>
                    <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">{t("watchlist.title")}</h1>
                    {entries.length > 0 && (
                        <div className="text-xs text-[#4A4A4A] font-mono mt-1" data-testid="watchlist-count">
                            {t("watchlist.count_companies", { n: entries.length })}
                            {activeAlertCount > 0 && <span className="opacity-70"> · {t("watchlist.count_with_alert", { n: activeAlertCount })}</span>}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <ViewToggle view={view} onChange={changeView} testid="watchlist-view-toggle" />
                    <Link to="/compare" className="btn-ghost" data-testid="watchlist-to-compare">{t("nav.compare")} <ArrowRight size={12} className="inline ml-1" /></Link>
                </div>
            </div>

            {!user && (
                <div className="border border-[#052049] bg-white p-4 mb-6 text-sm flex flex-wrap items-center justify-between gap-3" data-testid="login-prompt">
                    <div>
                        <div className="overline text-[#052049] mb-1">{t("watchlist.login_prompt_tag")}</div>
                        <div className="text-[#4A4A4A]">{t("watchlist.login_prompt_text")}</div>
                    </div>
                </div>
            )}

            {entries.length > 0 && <AlertInfoBanner context="watchlist" />}

            {!entries.length ? (
                <div className="border border-black bg-white p-12 text-center" data-testid="watchlist-empty">
                    <div className="font-serif text-3xl mb-2">{t("watchlist.empty_title")}</div>
                    <div className="text-sm text-[#4A4A4A] mb-6">{t("watchlist.empty_sub")}</div>
                    <Link to="/" className="btn-primary">{t("watchlist.empty_cta")}</Link>
                </div>
            ) : view === "cards" ? (
                <>
                <CardSort options={WL_SORT_OPTIONS} sort={sort} onChange={setSort} testid="watchlist-card-sort" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="watchlist-cards">
                    {loading && <div className="col-span-full text-center py-8 font-mono text-[#4A4A4A]">{t("common.loading")}</div>}
                    {!loading && sortedRows.map(({ entry, data: r }) => {
                        if (r.error) return (
                            <div key={r.ticker} className="border border-[#B32A22]/40 bg-white p-3 flex items-center justify-between" data-testid={`watchlist-card-${r.ticker}`}>
                                <span className="font-mono font-bold">{r.ticker}</span>
                                <span className="text-[#B32A22] text-xs">{r.error}</span>
                                <button onClick={() => handleRemove(r.ticker)} className="text-[#B32A22]" data-testid={`remove-${r.ticker}`}><Trash2 size={12} /></button>
                            </div>
                        );
                        const cr = r.custom_ratios || {};
                        const q = qual[r.ticker];
                        const useDisp = displayCur && displayCur !== "NATIVE";
                        return (
                            <CompanyCard
                                key={r.ticker}
                                testid={`watchlist-card-${r.ticker}`}
                                ticker={r.ticker}
                                name={r.name}
                                price={useDisp ? fxConvert(r.current_price, r.currency) : r.current_price}
                                priceCur={useDisp ? displayCur : r.currency}
                                mcap={useDisp ? fxConvert(r.market_cap, r.currency) : r.market_cap}
                                rc={cr.ratio_compra_pct}
                                rv={cr.ratio_venta_pct}
                                score={q?.score}
                                tam={q?.tam}
                                kpi={q?.kpi_coef}
                                nextEarnings={r.next_earnings_date}
                                badges={<span className={`overline px-1.5 py-0.5 border text-[9px] ${entry.mode === "manual" ? "border-[#1D7044] text-[#1D7044]" : "border-black/30 text-[#4A4A4A]"}`} data-testid={`mode-${r.ticker}`}>{entry.mode === "manual" ? "MAN" : "AUTO"}</span>}
                                actions={<>
                                    <AlertToggle enabled={!!entry.alert_enabled} onChange={(v) => { setWatchlistAlert(r.ticker, v); toast.success(v ? t("alerts.row_on") : t("alerts.row_off")); }} testid={r.ticker} />
                                    <button onClick={() => handleRemove(r.ticker)} className="text-[#B32A22] hover:text-black" data-testid={`remove-${r.ticker}`}><Trash2 size={13} /></button>
                                </>}
                            />
                        );
                    })}
                </div>
                </>
            ) : (
                <div className="border border-black bg-white overflow-x-auto" data-testid="watchlist-table">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-black">
                                <SortableTh label={t("watchlist.col_ticker")} sortKey="ticker" sort={sort} onSort={onSort} align="left" className="sticky left-0 z-20 bg-white w-[76px] min-w-[76px]" />
                                <SortableTh label={t("watchlist.col_company")} sortKey="name" sort={sort} onSort={onSort} align="left" className="sticky left-[76px] z-20 bg-white" />
                                <th className="overline text-center px-2 py-2">{t("watchlist.col_mode")}</th>
                                <SortableTh label={t("watchlist.col_price")} sortKey="price" sort={sort} onSort={onSort} align="right" />
                                <SortableTh label={t("watchlist.col_mcap")} sortKey="mcap" sort={sort} onSort={onSort} align="right" />
                                <th className="overline text-right px-2 py-2">Próx. result.</th>
                                <SortableTh label={t("watchlist.col_rc")} sortKey="rc" sort={sort} onSort={onSort} align="right" />
                                <th className="overline text-center px-2 py-2">
                                    <HoverTip text={t("portfolio.tt_buy_signal")}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help">{t("watchlist.col_signal")}</span>
                                    </HoverTip>
                                </th>
                                <SortableTh label={t("watchlist.col_rv")} sortKey="rv" sort={sort} onSort={onSort} align="right" />
                                <th className="overline text-center px-2 py-2">
                                    <HoverTip text={t("portfolio.tt_sell_signal")}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help">{t("watchlist.col_signal_sell")}</span>
                                    </HoverTip>
                                </th>
                                <SortableTh label={t("metrics.score")} sortKey="score" sort={sort} onSort={onSort} align="right" />
                                <SortableTh label={t("metrics.tam")} sortKey="tam" sort={sort} onSort={onSort} align="right" />
                                <SortableTh label={t("metrics.kpi")} sortKey="kpi" sort={sort} onSort={onSort} align="right" />
                                <th className="overline text-center px-2 py-2">
                                    <MasterAlertToggle
                                        total={entries.length}
                                        activeCount={activeAlertCount}
                                        onChange={toggleAllAlerts}
                                        disabled={!user}
                                    />
                                </th>
                                <th className="px-2 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan="15" className="px-2 py-6 text-center font-mono text-[#4A4A4A]">{t("common.loading")}</td></tr>}
                            {sortedRows.map(({ entry, data: r }) => {
                                if (r.error) return (
                                    <tr key={r.ticker} className="border-b border-black/10">
                                        <td className="px-2 py-2 font-mono sticky left-0 z-10 bg-white">{r.ticker}</td>
                                        <td colSpan="13" className="px-2 py-2 text-[#B32A22] text-xs">{r.error}</td>
                                        <td className="px-2 py-2 text-right">
                                            <button onClick={() => handleRemove(r.ticker)} data-testid={`remove-${r.ticker}`}><Trash2 size={12} /></button>
                                        </td>
                                    </tr>
                                );
                                const cr = r.custom_ratios || {};
                                const isManual = entry.mode === "manual";
                                return (
                                    <tr key={r.ticker} className="group border-b border-black/10 hover:bg-[#F5E4D4]" data-testid={`watchlist-row-${r.ticker}`}>
                                        <td className="px-2 py-2 font-mono font-semibold sticky left-0 z-10 bg-white group-hover:bg-[#F5E4D4]">
                                            <Link to={`/company/${r.ticker}`} className="underline-offset-2 hover:underline">{r.ticker}</Link>
                                        </td>
                                        <td className="px-2 py-2 text-[#4A4A4A] sticky left-[76px] z-10 bg-white group-hover:bg-[#F5E4D4]">{r.name}</td>
                                        <td className="px-2 py-2 text-center">
                                            {isManual ? (
                                                <span className="overline px-1.5 py-0.5 border border-[#1D7044] text-[#1D7044] bg-white text-[10px]" data-testid={`mode-${r.ticker}`}>MAN</span>
                                            ) : (
                                                <span className="overline px-1.5 py-0.5 border border-black/30 text-[#4A4A4A] bg-white text-[10px]" data-testid={`mode-${r.ticker}`}>AUTO</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono">{fmtPrice(displayCur && displayCur !== "NATIVE" ? fxConvert(r.current_price, r.currency) : r.current_price, displayCur && displayCur !== "NATIVE" ? displayCur : r.currency)}</td>
                                        <td className="px-2 py-2 text-right font-mono">{fmtNum(displayCur && displayCur !== "NATIVE" ? fxConvert(r.market_cap, r.currency) : r.market_cap)}</td>
                                        <td className="px-2 py-2 text-right"><NextEarnings iso={r.next_earnings_date} testid={`wl-earnings-${r.ticker}`} /></td>
                                        <td className="px-2 py-2 text-right font-mono" style={{ color: ratioColor(cr.ratio_compra_pct) }} data-testid={`rc-${r.ticker}`}>
                                            {fmtPctSigned(cr.ratio_compra_pct)}
                                        </td>
                                        <td className="px-2 py-2 text-center">
                                            <span className="overline px-1.5 py-0.5 border border-black text-[10px]" style={{ color: ratioColor(cr.ratio_compra_pct) }}>
                                                {signalLabel(cr.ratio_compra_pct)}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono" style={{ color: ratioColor(cr.ratio_venta_pct, "venta") }} data-testid={`rv-${r.ticker}`}>
                                            {fmtPctSigned(cr.ratio_venta_pct)}
                                        </td>
                                        <td className="px-2 py-2 text-center">
                                            <span className="overline px-1.5 py-0.5 border border-black text-[10px]" style={{ color: ratioColor(cr.ratio_venta_pct, "venta") }} data-testid={`signal-venta-${r.ticker}`}>
                                                {signalLabel(cr.ratio_venta_pct, "venta")}
                                            </span>
                                        </td>
                                        {(() => { const q = qual[r.ticker]; return (<>
                                        <td className="px-2 py-2 text-right font-mono" data-testid={`score-${r.ticker}`}>{q?.score == null ? "—" : <span style={{ color: q.score >= 70 ? "#1D7044" : q.score >= 50 ? "#B8860B" : "#B32A22" }}>{Number(q.score).toFixed(1)}</span>}</td>
                                        <td className="px-2 py-2 text-right font-mono" data-testid={`tam-${r.ticker}`}>{q?.tam == null ? "—" : Number(q.tam).toFixed(2)}</td>
                                        <td className="px-2 py-2 text-right font-mono" data-testid={`kpi-${r.ticker}`}>{q?.kpi_coef == null ? "—" : <span style={{ color: q.kpi_coef > 1.05 ? "#1D7044" : q.kpi_coef < 0.95 ? "#B32A22" : "#B8860B", fontWeight: 600 }}>{Number(q.kpi_coef).toFixed(2)}</span>}</td>
                                        </>); })()}
                                        <td className="px-2 py-2 text-center">
                                            <AlertToggle
                                                enabled={!!entry.alert_enabled}
                                                onChange={(v) => { setWatchlistAlert(r.ticker, v); toast.success(v ? t("alerts.row_on") : t("alerts.row_off")); }}
                                                testid={r.ticker}
                                            />
                                        </td>
                                        <td className="px-2 py-2 text-right">
                                            <button onClick={() => handleRemove(r.ticker)} className="text-[#B32A22] hover:text-black" data-testid={`remove-${r.ticker}`}>
                                                <Trash2 size={12} />
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
