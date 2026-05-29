import React from "react";
import { Bell } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * Wide info banner shown above the Watchlist / Portfolio table that explains
 * what the alert bell does and the default-state philosophy for each page.
 *
 * Style is intentionally subdued (no toggle inside) so it does not compete
 * with the table — purely informational.
 */
export default function AlertInfoBanner({ context = "watchlist" }) {
    const { t } = useI18n();
    const isPortfolio = context === "portfolio";
    // Inline color spans for the templated strings
    const cheap = <span className="text-[#1D7044] font-semibold">↓</span>;
    const expensive = <span className="text-[#B32A22] font-semibold">↑</span>;
    const bellActive = <span className="font-semibold" style={{ color: "var(--cheap)" }}>•</span>;
    const active = <span className="font-semibold text-[#1D7044]">●</span>;
    const off = <span className="font-semibold">○</span>;

    const fillTemplate = (key, vars) => {
        const src = t(key);
        const out = [];
        let s = src;
        for (const [k, node] of Object.entries(vars)) {
            const idx = s.indexOf(`{${k}}`);
            if (idx >= 0) {
                if (idx > 0) out.push(s.slice(0, idx));
                out.push(<React.Fragment key={k}>{node}</React.Fragment>);
                s = s.slice(idx + k.length + 2);
            }
        }
        if (s) out.push(s);
        return out;
    };

    return (
        <div className="border border-black bg-white p-4 mb-6 flex flex-wrap items-start gap-3 text-sm" data-testid={`alert-info-${context}`}>
            <div className="shrink-0 w-8 h-8 border border-black flex items-center justify-center" style={{ background: "var(--cheap)", color: "var(--text-on-dark)" }}>
                <Bell size={16} />
            </div>
            <div className="flex-1 min-w-[260px] space-y-2">
                <div className="overline text-[#4A4A4A]">{t("alerts.banner.eyebrow")}</div>
                <div className="text-[#4A4A4A] leading-relaxed">
                    {fillTemplate("alerts.banner.intro", { bell_active: bellActive })}
                </div>
                <ul className="text-[#4A4A4A] leading-relaxed list-disc pl-5 space-y-0.5">
                    <li>{fillTemplate("alerts.banner.case_buy", { cheap })}</li>
                    <li>{fillTemplate("alerts.banner.case_sell", { expensive })}</li>
                </ul>
                <div className="text-[#4A4A4A] leading-relaxed">{t("alerts.banner.master")}</div>
                <div className="text-xs text-[#4A4A4A] opacity-90 pt-1 border-t border-black/10">
                    {isPortfolio
                        ? fillTemplate("alerts.banner.default_portfolio", { active })
                        : fillTemplate("alerts.banner.default_watchlist", { off })}
                    {" "}
                    {t("alerts.banner.login_req")}
                </div>
            </div>
        </div>
    );
}
