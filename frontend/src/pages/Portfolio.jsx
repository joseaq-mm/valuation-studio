import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Trash2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { compare } from "@/lib/api";
import { getPortfolio, upsertPosition, removePosition, setPositionAlert } from "@/lib/portfolio";
import { fmtPrice, fmtNum, fmtPctSigned, ratioColor, signalLabel } from "@/lib/format";
import { computeCustomRatios } from "@/lib/customRatios";
import { useThresholds } from "@/lib/useThresholds";
import { useAuth } from "@/lib/auth";
import { useFx } from "@/lib/fx";
import { useI18n } from "@/lib/i18n";
import AlertToggle from "@/components/AlertToggle";
import HoverTip from "@/components/HoverTip";
import TickerAutocomplete from "@/components/TickerAutocomplete";

// Apply manual overrides to the API-fetched company snapshot before recomputing
// ratios. Mirrors the same logic the Watchlist page uses.
const enrichRow = (companyData, position) => {
    if (!companyData || companyData.error) return companyData;
    const cr = computeCustomRatios({
        revenue_2y: companyData.auto_projections?.revenue_2y,
        fcf_2y: companyData.auto_projections?.fcf_2y,
        shares_outstanding: companyData.shares_outstanding,
        gross_margin: companyData.gross_margin,
        operating_margin: companyData.operating_margin,
        net_debt: companyData.net_debt,
        market_cap: companyData.market_cap,
        revenue_cagr_4y: companyData.auto_projections?.revenue_cagr_4y,
        fcf_cagr_4y: companyData.auto_projections?.fcf_cagr_4y,
        current_price: companyData.current_price,
    });
    return { ...companyData, custom_ratios: cr };
};

export default function Portfolio() {
    const { t } = useI18n();
    const { user } = useAuth();
    const { display: displayCur, convert: fxConvert } = useFx();
    const [positions, setPositions] = useState([]);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [editing, setEditing] = useState(null);
    useThresholds();

    const load = async (poss) => {
        if (!poss.length) { setRows([]); return; }
        setLoading(true);
        try {
            const tickers = poss.map(p => p.ticker);
            const r = await compare(tickers);
            const byTicker = Object.fromEntries((r.results || []).map(x => [x.ticker, x]));
            setRows(poss.map(p => ({ position: p, ...enrichRow(byTicker[p.ticker], p) })));
        } catch { toast.error("Error al cargar"); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        const ps = getPortfolio();
        setPositions(ps);
        load(ps);
        const onChange = () => {
            const next = getPortfolio();
            setPositions(next);
            load(next);
        };
        window.addEventListener("vs:portfolio-changed", onChange);
        return () => window.removeEventListener("vs:portfolio-changed", onChange);
    }, []);

    const handleSave = (pos) => {
        upsertPosition(pos);
        setShowAdd(false);
        setEditing(null);
        toast.success(t("common.save"));
    };

    const handleRemove = (ticker) => {
        removePosition(ticker);
        toast(t("common.delete"));
    };

    const toggleAlert = (ticker, next) => {
        setPositionAlert(ticker, next);
        toast.success(next ? t("alerts.row_on") : t("alerts.row_off"));
    };

    const useDisplay = displayCur && displayCur !== "NATIVE";
    const convToDisplay = (v, fromCur) => useDisplay ? fxConvert(v, fromCur) : v;
    const displayCurFor = (nativeCur) => useDisplay ? displayCur : nativeCur;

    // Totals across all rows (converted to display currency for cross-ticker addition).
    // Positions with no shares or no buy_price are NOT counted into invested/now; we just
    // surface them as "tracked" rows. The "Total invested" KPI counts only complete positions.
    let totInvested = 0, totNow = 0, anyError = false, completeCount = 0;
    for (const r of rows) {
        const p = r.position || {};
        if (!p.shares || !p.buy_price) continue;
        const buyCur = p.buy_currency || r.currency || "USD";
        const invested = p.shares * p.buy_price;
        const now = (r.current_price || 0) * (p.shares || 0);
        const investedDisp = fxConvert(invested, buyCur);
        const nowDisp = fxConvert(now, r.currency || buyCur);
        if (investedDisp == null || nowDisp == null) { anyError = true; continue; }
        totInvested += investedDisp;
        totNow += nowDisp;
        completeCount += 1;
    }
    const totalsCur = useDisplay ? displayCur : "USD";
    const totalPl = totNow - totInvested;
    const totalPlPct = totInvested > 0 ? (totalPl / totInvested) * 100 : null;
    const trackedOnly = rows.length - completeCount;

    return (
        <div data-testid="portfolio-page">
            <div className="flex justify-between items-end mb-6 gap-3 flex-wrap">
                <div>
                    <div className="overline text-[#B32A22]">{t("portfolio.tag")}</div>
                    <h1 className="font-serif text-4xl sm:text-5xl tracking-tight">{t("portfolio.title")}</h1>
                </div>
                <div className="flex gap-2">
                    <Link to="/watchlist" className="btn-ghost" data-testid="portfolio-to-watchlist">{t("watchlist.title")} <ArrowRight size={12} className="inline ml-1" /></Link>
                    <button onClick={() => { setEditing(null); setShowAdd(true); }} className="btn-primary inline-flex items-center gap-1" data-testid="portfolio-add">
                        <Plus size={14} /> {t("portfolio.add_position")}
                    </button>
                </div>
            </div>

            {!user && (
                <div className="border border-[#052049] bg-white p-4 mb-6 text-sm" data-testid="portfolio-login-prompt">
                    <div className="overline text-[#052049] mb-1">{t("watchlist.login_prompt_tag")}</div>
                    <div className="text-[#4A4A4A]">{t("watchlist.login_prompt_text")}</div>
                </div>
            )}

            {completeCount > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <Kpi label={t("portfolio.total_invested")} value={fmtPrice(totInvested, totalsCur)} testid="kpi-invested" />
                    <Kpi label={t("portfolio.total_now")} value={fmtPrice(totNow, totalsCur)} testid="kpi-now" />
                    <Kpi label={t("portfolio.total_pl")} value={fmtPrice(totalPl, totalsCur)} color={totalPl >= 0 ? "var(--cheap)" : "var(--crimson)"} testid="kpi-pl" />
                    <Kpi label={`${t("portfolio.col_pl_pct")} ${anyError ? "(parcial)" : ""}`} value={totalPlPct == null ? "—" : fmtPctSigned(totalPlPct)} color={(totalPlPct || 0) >= 0 ? "var(--cheap)" : "var(--crimson)"} testid="kpi-pl-pct" />
                </div>
            )}
            {trackedOnly > 0 && (
                <div className="text-xs font-mono text-[#4A4A4A] mb-4" data-testid="portfolio-tracked-only-note">
                    {trackedOnly} {trackedOnly === 1 ? "posición sin datos" : "posiciones sin datos"} de acciones/precio (sólo seguimiento). Edita la fila para completar.
                </div>
            )}

            {!positions.length ? (
                <div className="border border-black bg-white p-12 text-center" data-testid="portfolio-empty">
                    <div className="font-serif text-3xl mb-2">{t("portfolio.empty_title")}</div>
                    <div className="text-sm text-[#4A4A4A] mb-6 max-w-md mx-auto">{t("portfolio.empty_sub")}</div>
                    <button onClick={() => setShowAdd(true)} className="btn-primary">{t("portfolio.add_position")}</button>
                </div>
            ) : (
                <div className="border border-black bg-white overflow-x-auto" data-testid="portfolio-table">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-black">
                                <th className="overline text-left px-2 py-2">{t("watchlist.col_ticker")}</th>
                                <th className="overline text-right px-2 py-2">{t("portfolio.col_shares")}</th>
                                <th className="overline text-right px-2 py-2">{t("portfolio.col_buy_price")}</th>
                                <th className="overline text-right px-2 py-2">{t("portfolio.col_invested")}</th>
                                <th className="overline text-right px-2 py-2">{t("watchlist.col_price")}</th>
                                <th className="overline text-right px-2 py-2">{t("portfolio.col_now")}</th>
                                <th className="overline text-right px-2 py-2">
                                    <HoverTip text={t("portfolio.tt_pl")}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help">{t("portfolio.col_pl")}</span>
                                    </HoverTip>
                                </th>
                                <th className="overline text-right px-2 py-2">
                                    <HoverTip text={t("portfolio.tt_pl_pct")}>
                                        <span className="underline decoration-dotted underline-offset-2 cursor-help">{t("portfolio.col_pl_pct")}</span>
                                    </HoverTip>
                                </th>
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
                                <th className="overline text-right px-2 py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan="14" className="px-3 py-6 text-center text-[#4A4A4A]">{t("common.loading")}</td></tr>}
                            {!loading && rows.map((r, i) => {
                                const p = r.position;
                                if (r.error) return (
                                    <tr key={p.ticker} className="border-b border-black/10">
                                        <td className="px-2 py-2 font-mono">{p.ticker}</td>
                                        <td colSpan="12" className="px-2 py-2 text-[#B32A22] text-xs">{r.error}</td>
                                        <td className="px-2 py-2 text-right">
                                            <button onClick={() => handleRemove(p.ticker)} data-testid={`remove-${p.ticker}`}><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                );
                                const buyCur = p.buy_currency || r.currency || "USD";
                                const showCur = displayCurFor(r.currency || buyCur);
                                const hasShares = p.shares != null && p.shares > 0;
                                const hasBuyPrice = p.buy_price != null && p.buy_price > 0;
                                const isComplete = hasShares && hasBuyPrice;
                                const invested = isComplete ? (p.shares * p.buy_price) : null;
                                const investedDisp = invested == null ? null : convToDisplay(invested, buyCur);
                                const now = hasShares ? ((r.current_price || 0) * p.shares) : null;
                                const nowDisp = now == null ? null : convToDisplay(now, r.currency || buyCur);
                                const buyPriceDisp = hasBuyPrice ? convToDisplay(p.buy_price, buyCur) : null;
                                const curPriceDisp = convToDisplay(r.current_price, r.currency || buyCur);
                                const pl = (nowDisp != null && investedDisp != null) ? (nowDisp - investedDisp) : null;
                                const plPct = (isComplete && r.current_price != null) ? ((r.current_price / p.buy_price) - 1) * 100 : null;
                                const cr = r.custom_ratios || {};
                                const trackedTag = !isComplete && (
                                    <span className="overline ml-2 px-1.5 py-0.5 border border-black/30 text-[#4A4A4A] text-[9px] align-middle" data-testid={`tracked-${p.ticker}`}>SEGUIMIENTO</span>
                                );
                                return (
                                    <tr key={p.ticker} className="border-b border-black/10 hover:bg-[#F5E4D4]" data-testid={`portfolio-row-${p.ticker}`}>
                                        <td className="px-2 py-2 font-mono font-semibold">
                                            <Link to={`/company/${p.ticker}`} className="hover:underline">{p.ticker}</Link>
                                            {trackedTag}
                                            {r.name && <div className="text-[10px] text-[#4A4A4A] font-sans mt-0.5">{r.name}</div>}
                                            {p.note && <div className="text-[10px] text-[#4A4A4A] font-sans mt-0.5 italic">{p.note}</div>}
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono">{hasShares ? fmtNum(p.shares) : "—"}</td>
                                        <td className="px-2 py-2 text-right font-mono">{hasBuyPrice ? fmtPrice(buyPriceDisp, showCur) : "—"}</td>
                                        <td className="px-2 py-2 text-right font-mono">{invested == null ? "—" : fmtPrice(investedDisp, showCur)}</td>
                                        <td className="px-2 py-2 text-right font-mono">{fmtPrice(curPriceDisp, showCur)}</td>
                                        <td className="px-2 py-2 text-right font-mono">{nowDisp == null ? "—" : fmtPrice(nowDisp, showCur)}</td>
                                        <td className="px-2 py-2 text-right font-mono" style={{ color: pl == null ? "var(--text-secondary)" : (pl >= 0 ? "var(--cheap)" : "var(--crimson)") }}>{pl == null ? "—" : fmtPrice(pl, showCur)}</td>
                                        <td className="px-2 py-2 text-right font-mono" style={{ color: plPct == null ? "var(--text-secondary)" : (plPct >= 0 ? "var(--cheap)" : "var(--crimson)") }}>{plPct == null ? "—" : fmtPctSigned(plPct)}</td>
                                        <td className="px-2 py-2 text-right font-mono" style={{ color: ratioColor(cr.ratio_compra_pct) }}>{fmtPctSigned(cr.ratio_compra_pct)}</td>
                                        <td className="px-2 py-2 text-center">
                                            <span className="overline px-1.5 py-0.5 border border-black text-[10px]" style={{ color: ratioColor(cr.ratio_compra_pct) }}>{signalLabel(cr.ratio_compra_pct)}</span>
                                        </td>
                                        <td className="px-2 py-2 text-right font-mono" style={{ color: ratioColor(cr.ratio_venta_pct, "venta") }}>{fmtPctSigned(cr.ratio_venta_pct)}</td>
                                        <td className="px-2 py-2 text-center">
                                            <span className="overline px-1.5 py-0.5 border border-black text-[10px]" style={{ color: ratioColor(cr.ratio_venta_pct, "venta") }}>{signalLabel(cr.ratio_venta_pct, "venta")}</span>
                                        </td>
                                        <td className="px-2 py-2 text-center">
                                            <AlertToggle enabled={!!p.alert_enabled} onChange={(v) => toggleAlert(p.ticker, v)} testid={p.ticker} />
                                        </td>
                                        <td className="px-2 py-2 text-right whitespace-nowrap">
                                            <button onClick={() => { setEditing(p); setShowAdd(true); }} className="text-[#4A4A4A] hover:text-black mr-1 text-[10px] underline" data-testid={`edit-${p.ticker}`}>Editar</button>
                                            <button onClick={() => handleRemove(p.ticker)} className="text-[#B32A22] hover:text-black" data-testid={`remove-${p.ticker}`}><Trash2 size={12} /></button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {showAdd && (
                <PositionDialog
                    initial={editing}
                    onClose={() => { setShowAdd(false); setEditing(null); }}
                    onSave={handleSave}
                />
            )}
        </div>
    );
}

function Kpi({ label, value, color, testid }) {
    return (
        <div className="border border-black bg-white p-3" data-testid={testid}>
            <div className="overline text-[#4A4A4A]">{label}</div>
            <div className="font-mono text-xl mt-1" style={{ color: color || "var(--text-primary)" }}>{value}</div>
        </div>
    );
}

function PositionDialog({ initial, onClose, onSave }) {
    const { t } = useI18n();
    const [ticker, setTicker] = useState(initial?.ticker || "");
    const [shares, setShares] = useState(initial?.shares == null ? "" : initial.shares);
    const [buyPrice, setBuyPrice] = useState(initial?.buy_price == null ? "" : initial.buy_price);
    const [buyCurrency, setBuyCurrency] = useState(initial?.buy_currency || "");
    const [buyDate, setBuyDate] = useState(initial?.buy_date || "");
    const [note, setNote] = useState(initial?.note || "");

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!ticker.trim()) {
            toast.error("El ticker es obligatorio.");
            return;
        }
        // shares + buy_price are optional — allow saving a ticker as "tracked, no position size yet"
        const sStr = String(shares).trim().replace(",", ".");
        const pStr = String(buyPrice).trim().replace(",", ".");
        const sNum = sStr === "" ? null : parseFloat(sStr);
        const pNum = pStr === "" ? null : parseFloat(pStr);
        // If either field has text, it must parse to a positive number
        if (sStr !== "" && (isNaN(sNum) || sNum <= 0)) {
            toast.error("Acciones debe ser un número positivo (o déjalo vacío).");
            return;
        }
        if (pStr !== "" && (isNaN(pNum) || pNum <= 0)) {
            toast.error("Precio de compra debe ser un número positivo (o déjalo vacío).");
            return;
        }
        onSave({
            ticker: ticker.trim().toUpperCase(),
            shares: sNum,
            buy_price: pNum,
            buy_currency: buyCurrency.trim().toUpperCase() || null,
            buy_date: buyDate || null,
            note: note.trim() || null,
            alert_enabled: initial?.alert_enabled || false,
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(17,17,17,0.5)" }} data-testid="position-dialog">
            <form onSubmit={handleSubmit} className="bg-white border border-black p-6 w-full max-w-md">
                <div className="flex items-start justify-between mb-3">
                    <div>
                        <div className="overline text-[#B32A22]">{t("portfolio.tag")}</div>
                        <h2 className="font-serif text-2xl">{t("portfolio.dialog_title")}</h2>
                    </div>
                    <button type="button" onClick={onClose}><X size={16} /></button>
                </div>

                <Field label={t("portfolio.field_ticker")}>
                    {initial ? (
                        <input value={ticker} className="input-paper font-mono w-full" disabled data-testid="pos-ticker" />
                    ) : (
                        <TickerAutocomplete
                            value={ticker}
                            onChange={setTicker}
                            onPick={(r) => setTicker(r.symbol)}
                            placeholder="AAPL, NVDA, SAP.DE, SAN.MC…"
                            testid="pos-ticker"
                        />
                    )}
                </Field>
                <Field label={`${t("portfolio.field_shares")} (opcional)`}>
                    <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="Déjalo vacío si aún no quieres registrar la cantidad" className="input-paper font-mono w-full" inputMode="decimal" data-testid="pos-shares" />
                </Field>
                <Field label={`${t("portfolio.field_buy_price")} (opcional)`}>
                    <input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="Déjalo vacío para rellenarlo más tarde" className="input-paper font-mono w-full" inputMode="decimal" data-testid="pos-price" />
                </Field>
                <Field label={t("portfolio.field_buy_currency")}>
                    <input value={buyCurrency} onChange={(e) => setBuyCurrency(e.target.value)} placeholder="EUR / USD / GBP…" className="input-paper font-mono w-full uppercase" data-testid="pos-currency" />
                </Field>
                <Field label={t("portfolio.field_buy_date")}>
                    <input type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} className="input-paper font-mono w-full" data-testid="pos-date" />
                </Field>
                <Field label={t("portfolio.field_note")}>
                    <input value={note} onChange={(e) => setNote(e.target.value)} className="input-paper w-full" data-testid="pos-note" />
                </Field>

                <div className="flex justify-end gap-2 mt-4">
                    <button type="button" onClick={onClose} className="btn-ghost" data-testid="pos-cancel">{t("common.cancel")}</button>
                    <button type="submit" className="btn-primary" data-testid="pos-save">{t("common.save")}</button>
                </div>
            </form>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <label className="block mt-2">
            <span className="overline text-[#4A4A4A]">{label}</span>
            <div className="mt-1">{children}</div>
        </label>
    );
}
