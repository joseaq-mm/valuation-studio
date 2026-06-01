import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, ArrowRight, AlertTriangle, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisCompanyQual } from "@/lib/api";
import { ScoreBar, ScoreBadge } from "./ScoreBar";

const DIMS = ["competitive_position", "sector_momentum", "management_quality", "financial_resilience"];

/**
 * Bridges the qualitative Thesis Engine with the quantitative company dashboard.
 * Shows the saved qualitative snapshot for this ticker (if the logged-in user
 * has generated one), or a CTA to generate it.
 */
export default function CompanyQualCard({ ticker }) {
    const { user } = useAuth();
    const [snap, setSnap] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        if (!user || !ticker) { setLoading(false); setSnap(null); return; }
        setLoading(true);
        thesisCompanyQual(ticker)
            .then((d) => { if (alive) setSnap(d); })
            .catch(() => { if (alive) setSnap(null); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [user, ticker]);

    if (loading) return null;

    // Not logged in → subtle prompt
    if (!user) {
        return (
            <div className="border border-black bg-[#F5E4D4] p-4 mb-6 flex items-center justify-between gap-4 flex-wrap" data-testid="company-qual-login">
                <div className="flex items-center gap-2 text-sm">
                    <Sparkles size={16} className="text-[#052049]" />
                    <span>Genera un <strong>análisis cualitativo con IA</strong> de {ticker}: tendencias en las que encaja, rol en la cadena de valor y score.</span>
                </div>
                <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="btn-ghost flex items-center gap-1 shrink-0" data-testid="company-qual-cta">
                    Ir a Tesis <ArrowRight size={13} />
                </Link>
            </div>
        );
    }

    // Logged in, no snapshot → CTA to generate
    if (!snap) {
        return (
            <div className="border border-dashed border-black/40 bg-white p-4 mb-6 flex items-center justify-between gap-4 flex-wrap" data-testid="company-qual-empty">
                <div className="flex items-center gap-2 text-sm text-[#4A4A4A]">
                    <Sparkles size={16} className="text-[#052049]" />
                    <span>Aún no tienes una tesis cualitativa de <strong>{ticker}</strong>.</span>
                </div>
                <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="btn-primary flex items-center gap-1 shrink-0" data-testid="company-qual-generate">
                    <Sparkles size={13} /> Generar tesis
                </Link>
            </div>
        );
    }

    const isReverse = Array.isArray(snap.company_trends);

    return (
        <div className="border border-black bg-white p-5 mb-6" data-testid="company-qual-card">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div className="overline text-[#B32A22]">Tesis cualitativa · IA</div>
                    {!isReverse && snap.trend && (
                        <div className="text-sm mt-1">Encaja en la tendencia <strong>{snap.trend}</strong>{snap.value_chain_role ? ` — ${snap.value_chain_role}` : ""}</div>
                    )}
                    {isReverse && <div className="text-sm mt-1">Relevancia temática global de {ticker}</div>}
                </div>
                <ScoreBadge value={isReverse ? snap.overall_relevance : snap.overall_score} label={isReverse ? "Relevancia" : "Score global"} testid="company-qual-score" />
            </div>

            {!isReverse && snap.scores && (
                <div className="grid grid-cols-2 gap-x-5 gap-y-2 mt-4 max-w-xl">
                    {DIMS.map((d) => <ScoreBar key={d} dimension={d} value={snap.scores[d]} />)}
                </div>
            )}

            {!isReverse && snap.thesis && (
                <div className="mt-4 border-l-2 border-[#052049] pl-3 max-w-3xl">
                    <p className="text-sm leading-relaxed">{snap.thesis}</p>
                </div>
            )}
            {!isReverse && snap.key_risks && (
                <div className="mt-3 flex gap-2 text-xs text-[#B32A22] max-w-3xl">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>{snap.key_risks}</span>
                </div>
            )}

            {isReverse && (
                <div className="mt-4 space-y-1.5 max-w-2xl">
                    {snap.company_trends.slice(0, 5).map((t, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                            <TrendingUp size={13} className="text-[#052049] shrink-0" />
                            <span className="flex-1">{t.name}</span>
                            <span className="font-mono text-xs font-semibold" style={{ color: (t.relevance_score ?? 0) >= 75 ? "#1E7D45" : (t.relevance_score ?? 0) >= 50 ? "#B8860B" : "#B32A22" }}>
                                {t.relevance_score ?? "—"}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {snap.thesis_id && (
                <Link to={`/thesis/${snap.thesis_id}`} className="inline-flex items-center gap-1 mt-4 text-xs text-[#052049] hover:underline" data-testid="company-qual-link">
                    Ver tesis completa <ArrowRight size={12} />
                </Link>
            )}
        </div>
    );
}
