import React from "react";

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// A "next earnings" date is only valid if it is today or later. Bold/black if ≤ 7 days.
export const nextEarningsInfo = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dLocal = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (dLocal < today) return null;
    const days = Math.round((dLocal - today) / 86400000);
    const sameYear = d.getUTCFullYear() === new Date().getFullYear();
    const label = `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}${sameYear ? "" : " '" + String(d.getUTCFullYear()).slice(2)}`;
    return { label, soon: days <= 7, days };
};

export const NextEarnings = ({ iso, testid }) => {
    const e = nextEarningsInfo(iso);
    if (!e) return <span className="text-[#9A9A9A] font-mono" data-testid={testid}>—</span>;
    return (
        <span className={`font-mono tabular-nums whitespace-nowrap ${e.soon ? "font-bold text-black" : "text-[#4A4A4A]"}`} data-testid={testid}>
            {e.label}
        </span>
    );
};

export default NextEarnings;
