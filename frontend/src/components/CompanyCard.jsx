import React from "react";
import { Link } from "react-router-dom";
import { fmtPrice, fmtNum, fmtPctSigned, ratioColor, signalLabel } from "@/lib/format";
import { NextEarnings } from "@/components/NextEarnings";

const qColor = (s) => (s >= 70 ? "#1D7044" : s >= 50 ? "#B8860B" : "#B32A22");

// Presentational company card with the data common to Nivel 1 & 2 (no position-only
// fields like shares/buy price/P&L). `badges` and `actions` are injected per level.
export const CompanyCard = ({ ticker, name, price, priceCur, mcap, rc, rv, score, tam, kpi, nextEarnings, badges, actions, testid }) => (
    <div className="border border-black bg-white p-3 flex flex-col gap-2 hover:shadow-[3px_3px_0_0_rgba(0,0,0,0.12)] transition-shadow" data-testid={testid}>
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <Link to={`/company/${ticker}`} className="font-mono font-bold text-base hover:underline">{ticker}</Link>
                    {badges}
                </div>
                {name && <div className="text-[11px] text-[#4A4A4A] font-sans truncate" title={name}>{name}</div>}
            </div>
            <div className="text-right shrink-0">
                <div className="overline text-[9px] text-[#9A9A9A]">Próx. result.</div>
                <NextEarnings iso={nextEarnings} testid={testid ? `${testid}-earnings` : undefined} />
            </div>
        </div>

        <div className="flex items-center justify-between text-xs font-mono border-y border-black/10 py-1.5">
            <span><span className="text-[#9A9A9A]">Precio </span>{fmtPrice(price, priceCur)}</span>
            <span><span className="text-[#9A9A9A]">MCap </span>{fmtNum(mcap)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
            <div className="border border-black/15 p-2">
                <div className="overline text-[9px] text-[#4A4A4A]">Ratio Compra</div>
                <div className="font-mono text-lg leading-tight" style={{ color: ratioColor(rc) }}>{fmtPctSigned(rc)}</div>
                <span className="overline inline-block mt-1 px-1.5 py-0.5 border border-black text-[9px]" style={{ color: ratioColor(rc) }}>{signalLabel(rc)}</span>
            </div>
            <div className="border border-black/15 p-2">
                <div className="overline text-[9px] text-[#4A4A4A]">Ratio Venta</div>
                <div className="font-mono text-lg leading-tight" style={{ color: ratioColor(rv, "venta") }}>{fmtPctSigned(rv)}</div>
                <span className="overline inline-block mt-1 px-1.5 py-0.5 border border-black text-[9px]" style={{ color: ratioColor(rv, "venta") }}>{signalLabel(rv, "venta")}</span>
            </div>
        </div>

        <div className="grid grid-cols-3 gap-1 text-center text-xs font-mono">
            <div><div className="overline text-[9px] text-[#9A9A9A]">Score</div><span style={{ color: score == null ? "#9A9A9A" : qColor(score) }}>{score == null ? "—" : Number(score).toFixed(1)}</span></div>
            <div><div className="overline text-[9px] text-[#9A9A9A]">TAM</div><span>{tam == null ? "—" : Number(tam).toFixed(2)}</span></div>
            <div><div className="overline text-[9px] text-[#9A9A9A]">Coef KPI</div><span style={{ color: kpi == null ? "#9A9A9A" : (kpi > 1.05 ? "#1D7044" : kpi < 0.95 ? "#B32A22" : "#B8860B"), fontWeight: 600 }}>{kpi == null ? "—" : Number(kpi).toFixed(2)}</span></div>
        </div>

        {actions && <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-2 mt-auto">{actions}</div>}
    </div>
);

export default CompanyCard;
