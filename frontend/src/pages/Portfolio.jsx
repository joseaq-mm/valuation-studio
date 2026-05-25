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
    let totInvested = 0, totNow = 0, anyError = false;
    for (const r of rows) {
        const p = r.position || {};
        const buyCur = p.buy_currency || r.currency || "USD";
        const invested = p.shares * p.buy_price;
        const now = (r.current_price || 0) * (p.shares || 0);
        const investedDisp = fxConvert(invested, buyCur);
        const nowDisp = fxConvert(now, r.currency || buyCur);
        if (investedDisp == null || nowDisp == null) anyError = true;
        else { totInvested += investedDisp; totNow += nowDisp; }
    }
    const totalsCur = useDisplay ? displayCur : "USD"; // when in NATIVE mode show USD as a normalised total
    const totalPl = totNow - totInvested;
    const totalPlPct = totInvested > 0 ? (totalPl / totInvested) * 100 : null;

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

            {rows.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <Kpi label={t("portfolio.total_invested")} value={fmtPrice(totInvested, totalsCur)} testid="kpi-invested" />
                    <Kpi label={t("portfolio.total_now")} value={fmtPrice(totNow, totalsCur)} testid="kpi-now" />
                    <Kpi label={t("portfolio.total_pl")} value={fmtPrice(totalPl, totalsCur)} color={totalPl >= 0 ? "var(--cheap)" : "var(--crimson)"} testid="kpi-pl" />
                    <Kpi label={`${t("portfolio.col_pl_pct")} ${anyError ? "(parcial)" : ""}`} value={totalPlPct == null ? "—" : fmtPctSigned(totalPlPct)} color={(totalPlPct || 0) >= 0 ? "var(--cheap)" : "var(--crimson)"} testid="kpi-pl-pct" />
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
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-black">
                                <th className="overline text-left px-3 py-3">{t("watchlist.col_ticker")}</th>
                                <th className="overline text-right px-3 py-3">{t("portfolio.col_shares")}</th>
                                <th className="overline text-right px-3 py-3">{t("portfolio.col_buy_price")}</th>
                                <th className="overline text-right px-3 py-3">{t("portfolio.col_invested")}</th>
                                <th className="overline text-right px-3 py-3">{t("watchlist.col_price")}</th>
                                <th className="overline text-right px-3 py-3">{t("portfolio.col_now")}</th>
                                <th className="overline text-right px-3 py-3">{t("portfolio.col_pl")}</th>
                                <th className="overline text-right px-3 py-3">{t("portfolio.col_pl_pct")}</th>
                                <th className="overline text-right px-3 py-3">{t("watchlist.col_rc")}</th>
                                <th className="overline text-center px-3 py-3">{t("watchlist.col_signal")}</th>
                                <th className="overline text-center px-3 py-3">{t("watchlist.col_alert")}</th>
                                <th className="overline text-right px-3 py-3">{t("common.actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && <tr><td colSpan="12" className="px-3 py-6 text-center text-[#4A4A4A]">{t("common.loading")}</td></tr>}
                            {!loading && rows.map((r, i) => {
                                const p = r.position;
                                if (r.error) return (
                                    <tr key={p.ticker} className="border-b border-black/10">
                                        <td className="px-3 py-3 font-mono">{p.ticker}</td>
                                        <td colSpan="10" className="px-3 py-3 text-[#B32A22] text-xs">{r.error}</td>
                                        <td className="px-3 py-3 text-right">
                                            <button onClick={() => handleRemove(p.ticker)} data-testid={`remove-${p.ticker}`}><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                );
                                const buyCur = p.buy_currency || r.currency || "USD";
                                const showCur = displayCurFor(r.currency || buyCur);
                                const invested = (p.shares || 0) * (p.buy_price || 0);
                                const investedDisp = convToDisplay(invested, buyCur);
                                const now = (r.current_price || 0) * (p.shares || 0);
                                const nowDisp = convToDisplay(now, r.currency || buyCur);
                                const buyPriceDisp = convToDisplay(p.buy_price, buyCur);
                                const curPriceDisp = convToDisplay(r.current_price, r.currency || buyCur);
                                const pl = (nowDisp != null && investedDisp != null) ? (nowDisp - investedDisp) : null;
                                const plPct = (invested > 0 && r.current_price != null) ? ((r.current_price / (p.buy_price || 1)) - 1) * 100 : null;
                                // ^ P/L % uses native ticker price ratio, currency-agnostic
                                const cr = r.custom_ratios || {};
                                return (
                                    <tr key={p.ticker} className="border-b border-black/10 hover:bg-[#F5E4D4]" data-testid={`portfolio-row-${p.ticker}`}>
                                        <td className="px-3 py-3 font-mono font-semibold">
                                            <Link to={`/company/${p.ticker}`} className="hover:underline">{p.ticker}</Link>
                                            {p.note && <div className="text-[10px] text-[#4A4A4A] font-sans mt-0.5">{p.note}</div>}
                                        </td>
                                        <td className="px-3 py-3 text-right font-mono">{fmtNum(p.shares)}</td>
                                        <td className="px-3 py-3 text-right font-mono">{fmtPrice(buyPriceDisp, showCur)}</td>
                                        <td className="px-3 py-3 text-right font-mono">{fmtPrice(investedDisp, showCur)}</td>
                                        <td className="px-3 py-3 text-right font-mono">{fmtPrice(curPriceDisp, showCur)}</td>
                                        <td className="px-3 py-3 text-right font-mono">{fmtPrice(nowDisp, showCur)}</td>
                                        <td className="px-3 py-3 text-right font-mono" style={{ color: (pl || 0) >= 0 ? "var(--cheap)" : "var(--crimson)" }}>{fmtPrice(pl, showCur)}</td>
                                        <td className="px-3 py-3 text-right font-mono" style={{ color: (plPct || 0) >= 0 ? "var(--cheap)" : "var(--crimson)" }}>{plPct == null ? "—" : fmtPctSigned(plPct)}</td>
                                        <td className="px-3 py-3 text-right font-mono" style={{ color: ratioColor(cr.ratio_compra_pct) }}>{fmtPctSigned(cr.ratio_compra_pct)}</td>
                                        <td className="px-3 py-3 text-center">
                                            <span className="overline px-2 py-1 border border-black" style={{ color: ratioColor(cr.ratio_compra_pct) }}>{signalLabel(cr.ratio_compra_pct)}</span>
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <AlertToggle enabled={!!p.alert_enabled} onChange={(v) => toggleAlert(p.ticker, v)} testid={p.ticker} />
                                        </td>
                                        <td className="px-3 py-3 text-right whitespace-nowrap">
                                            <button onClick={() => { setEditing(p); setShowAdd(true); }} className="text-[#4A4A4A] hover:text-black mr-2 text-xs underline" data-testid={`edit-${p.ticker}`}>Editar</button>
                                            <button onClick={() => handleRemove(p.ticker)} className="text-[#B32A22] hover:text-black" data-testid={`remove-${p.ticker}`}><Trash2 size={14} /></button>
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
    const [shares, setShares] = useState(initial?.shares ?? "");
    const [buyPrice, setBuyPrice] = useState(initial?.buy_price ?? "");
    const [buyCurrency, setBuyCurrency] = useState(initial?.buy_currency || "");
    const [buyDate, setBuyDate] = useState(initial?.buy_date || "");
    const [note, setNote] = useState(initial?.note || "");

    const handleSubmit = (e) => {
        e.preventDefault();
        const sNum = parseFloat(String(shares).replace(",", "."));
        const pNum = parseFloat(String(buyPrice).replace(",", "."));
        if (!ticker.trim() || isNaN(sNum) || sNum <= 0 || isNaN(pNum) || pNum <= 0) {
            toast.error("Revisa los datos: ticker, acciones y precio son obligatorios.");
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
                    <input value={ticker} onChange={(e) => setTicker(e.target.value)} className="input-paper font-mono w-full" disabled={!!initial} data-testid="pos-ticker" />
                </Field>
                <Field label={t("portfolio.field_shares")}>
                    <input value={shares} onChange={(e) => setShares(e.target.value)} className="input-paper font-mono w-full" inputMode="decimal" data-testid="pos-shares" />
                </Field>
                <Field label={t("portfolio.field_buy_price")}>
                    <input value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} className="input-paper font-mono w-full" inputMode="decimal" data-testid="pos-price" />
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
