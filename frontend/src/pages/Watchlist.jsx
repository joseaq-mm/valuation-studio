import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getWatchlist, getWatchlistTickers, removeFromWatchlist, setWatchlistAlert } from "@/lib/storage";
import { compare } from "@/lib/api";
import { computeCustomRatios, autoInputsFromData } from "@/lib/customRatios";
import { fmtPrice, fmtNum, fmtPctSigned, ratioColor, signalLabel } from "@/lib/format";
import { useThresholds } from "@/lib/useThresholds";
import { useAuth } from "@/lib/auth";
import { useFx } from "@/lib/fx";
import { useI18n } from "@/lib/i18n";
import { notifyGet, notifyPut } from "@/lib/api";
import AlertToggle from "@/components/AlertToggle";
import HoverTip from "@/components/HoverTip";
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
    const { user } = useAuth();
    const [notify, setNotify] = useState(null);
    const { display: displayCur, convert: fxConvert } = useFx();
    const { t } = useI18n();
    useThresholds(); // re-render on threshold changes

    useEffect(() => {
        if (!user) { setNotify(null); return; }
        notifyGet().then(setNotify).catch(() => setNotify({ enabled: false, cross_buy_zone: true, cross_sell_zone: true }));
    }, [user]);

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
                    <div className="overline text-[#B32A22]">{t("watchlist.tag")}</div>
                    <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">{t("watchlist.title")}</h1>
                </div>
                <Link to="/compare" className="btn-ghost" data-testid="watchlist-to-compare">{t("nav.compare")} <ArrowRight size={12} className="inline ml-1" /></Link>
            </div>

            {!user && (
                <div className="border border-[#052049] bg-white p-4 mb-6 text-sm flex flex-wrap items-center justify-between gap-3" data-testid="login-prompt">
                    <div>
                        <div className="overline text-[#052049] mb-1">{t("watchlist.login_prompt_tag")}</div>
                        <div className="text-[#4A4A4A]">{t("watchlist.login_prompt_text")}</div>
                    </div>
                </div>
            )}

            {user && notify && (
                <div className="border border-black bg-white p-4 mb-6" data-testid="notify-card">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div className="overline text-[#4A4A4A]">{t("alerts.tag")}</div>
                            <div className="text-xs text-[#4A4A4A] max-w-md">
                                Cada noche (06:00 UTC) revisamos los tickers que tengan la <span className="font-semibold">campana activada</span> en tu watchlist y cartera. Te avisamos solo cuando una acción <span className="text-[#1D7044] font-semibold">cruza a barata</span> o <span className="text-[#B32A22] font-semibold">deja de estar barata</span>.
                            </div>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer" data-testid="notify-enabled">
                            <input
                                type="checkbox"
                                checked={!!notify.enabled}
                                onChange={(e) => updateNotify({ enabled: e.target.checked })}
                            />
                            <span className="overline">{notify.enabled ? "Activadas" : "Desactivadas"}</span>
                        </label>
                    </div>
                    {notify.enabled && (
                        <div className="flex flex-wrap gap-4 mt-3 text-xs">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={!!notify.cross_buy_zone}
                                    onChange={(e) => updateNotify({ cross_buy_zone: e.target.checked })}
                                    data-testid="notify-buy"
                                />
                                <span>Avisarme cuando cruza a <span className="text-[#1D7044] font-semibold">BARATA</span></span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={!!notify.cross_sell_zone}
                                    onChange={(e) => updateNotify({ cross_sell_zone: e.target.checked })}
                                    data-testid="notify-sell"
                                />
                                <span>Avisarme cuando <span className="text-[#B32A22] font-semibold">deja de estar barata</span></span>
                            </label>
                        </div>
                    )}
                </div>
            )}

            {!entries.length ? (
                <div className="border border-black bg-white p-12 text-center" data-testid="watchlist-empty">
                    <div className="font-serif text-3xl mb-2">{t("watchlist.empty_title")}</div>
                    <div className="text-sm text-[#4A4A4A] mb-6">{t("watchlist.empty_sub")}</div>
                    <Link to="/" className="btn-primary">{t("watchlist.empty_cta")}</Link>
                </div>
            ) : (
                <div className="border border-black bg-white overflow-x-auto" data-testid="watchlist-table">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-black">
                                <th className="overline text-left px-2 py-2">{t("watchlist.col_ticker")}</th>
                                <th className="overline text-left px-2 py-2">{t("watchlist.col_company")}</th>
                                <th className="overline text-center px-2 py-2">{t("watchlist.col_mode")}</th>
                                <th className="overline text-right px-2 py-2">{t("watchlist.col_price")}</th>
                                <th className="overline text-right px-2 py-2">{t("watchlist.col_mcap")}</th>
                                <th className="overline text-right px-2 py-2">{t("watchlist.col_rc")}</th>
                                <th className="overline text-center px-2 py-2">
                                    <HoverTip text={t("portfolio.tt_buy_signal")}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help">{t("watchlist.col_signal")}</span>
                                    </HoverTip>
                                </th>
                                <th className="overline text-right px-2 py-2">{t("watchlist.col_rv")}</th>
                                <th className="overline text-center px-2 py-2">
                                    <HoverTip text={t("portfolio.tt_sell_signal")}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help">{t("watchlist.col_signal_sell")}</span>
                                    </HoverTip>
                                </th>
                                <th className="overline text-center px-2 py-2">{t("watchlist.col_alert")}</th>
                                <th className="px-2 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan="11" className="px-2 py-6 text-center font-mono text-[#4A4A4A]">{t("common.loading")}</td></tr>}
                            {rows.map(({ entry, data: r }) => {
                                if (r.error) return (
                                    <tr key={r.ticker} className="border-b border-black/10">
                                        <td className="px-2 py-2 font-mono">{r.ticker}</td>
                                        <td colSpan="9" className="px-2 py-2 text-[#B32A22] text-xs">{r.error}</td>
                                        <td className="px-2 py-2 text-right">
                                            <button onClick={() => handleRemove(r.ticker)} data-testid={`remove-${r.ticker}`}><Trash2 size={12} /></button>
                                        </td>
                                    </tr>
                                );
                                const cr = r.custom_ratios || {};
                                const isManual = entry.mode === "manual";
                                return (
                                    <tr key={r.ticker} className="border-b border-black/10 hover:bg-[#F5E4D4]" data-testid={`watchlist-row-${r.ticker}`}>
                                        <td className="px-2 py-2 font-mono font-semibold">
                                            <Link to={`/company/${r.ticker}`} className="underline-offset-2 hover:underline">{r.ticker}</Link>
                                        </td>
                                        <td className="px-2 py-2 text-[#4A4A4A]">{r.name}</td>
                                        <td className="px-2 py-2 text-center">
                                            {isManual ? (
                                                <span className="overline px-1.5 py-0.5 border border-[#1D7044] text-[#1D7044] bg-white text-[10px]" data-testid={`mode-${r.ticker}`}>MAN</span>
                                            ) : (
                                                <span className="overline px-1.5 py-0.5 border border-black/30 text-[#4A4A4A] bg-white text-[10px]" data-testid={`mode-${r.ticker}`}>AUTO</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono">{fmtPrice(displayCur && displayCur !== "NATIVE" ? fxConvert(r.current_price, r.currency) : r.current_price, displayCur && displayCur !== "NATIVE" ? displayCur : r.currency)}</td>
                                        <td className="px-2 py-2 text-right font-mono">{fmtNum(displayCur && displayCur !== "NATIVE" ? fxConvert(r.market_cap, r.currency) : r.market_cap)}</td>
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
