import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { thesisCompanyProfile } from "@/lib/api";
import { ValueBox, scoreColor, tamColor, fmtTamScore } from "./ScoreBar";

import HoverTip from "@/components/HoverTip";

/**
 * Bridges the qualitative Thesis Engine with the quantitative company dashboard.
 * Lists every saved TREND thesis where this ticker appears — one line each, with
 * the trend (bold, linked to the full thesis), its "Score global tendencia" and
 * its TAM Score. Footer: average of all overall scores (overall quality) and the
 * sum of all TAM Scores (total potential).
 */
export default function CompanyQualCard({ ticker, hideEmpty = false, refreshKey = 0 }) {
    const { user } = useAuth();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        if (!user || !ticker) { setLoading(false); setProfile(null); return; }
        setLoading(true);
        thesisCompanyProfile(ticker)
            .then((d) => { if (alive) setProfile(d); })
            .catch(() => { if (alive) setProfile(null); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [user, ticker, refreshKey]);

    if (loading) return null;

    // Embedded inside the thesis result (hideEmpty): show nothing when logged out
    // or when there is no qualitative data — the surrounding page handles those.
    if (hideEmpty && (!user || (!(profile?.trend_rows || []).length && !profile?.reverse))) return null;

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

    const rows = profile?.trend_rows || [];
    const reverse = profile?.reverse;

    // Logged in but the company is not part of any saved thesis → CTA to generate.
    if (!rows.length && !reverse) {
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

    const COLS = "grid-cols-[1fr_5rem_4.5rem]";

    return (
        <div className="border border-black bg-white p-5 mb-6" data-testid="company-qual-card">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="overline text-[#B32A22]">Tesis cualitativa · tesis guardadas</div>
                <Link to={`/thesis?company=${encodeURIComponent(ticker)}`} className="text-xs text-[#052049] hover:underline inline-flex items-center gap-1" data-testid="company-qual-add">
                    <Sparkles size={12} /> Buscar más tesis
                </Link>
            </div>

            {rows.length > 0 && (
                <>
                    {/* Column headers */}
                    <div className={`grid ${COLS} gap-x-4 items-end pb-1.5 border-b border-black`}>
                        <div className="overline text-[#4A4A4A]">Tesis</div>
                        <div className="overline text-[#4A4A4A] text-center leading-tight">Score global tesis</div>
                        <div className="overline text-[#4A4A4A] text-center leading-tight">TAM Score</div>
                    </div>

                    {/* One line per thesis */}
                    {rows.map((r) => (
                        <div key={r.thesis_id} className={`grid ${COLS} gap-x-4 items-center py-2.5 border-b border-black/10`} data-testid={`qual-row-${r.thesis_id}`}>
                            <div className="min-w-0">
                                <Link to={`/thesis/${r.thesis_id}`} className="font-bold text-sm leading-tight hover:underline inline-flex items-center gap-1" data-testid={`qual-row-link-${r.thesis_id}`}>
                                    <span className="truncate">{r.thesis_title}</span>
                                    <ArrowRight size={12} className="shrink-0" />
                                </Link>
                                {r.value_chain_role && <div className="overline text-[#9CA3AF] mt-0.5 truncate">{r.value_chain_role}</div>}
                            </div>
                            <div className="flex justify-center">
                                <ValueBox text={r.overall_score ?? "—"} color={scoreColor(r.overall_score)} testid={`qual-overall-${r.thesis_id}`} />
                            </div>
                            <div className="flex justify-center">
                                <ValueBox text={fmtTamScore(r.tam_score) ?? "—"} color={tamColor(r.tam_score)} testid={`qual-tam-${r.thesis_id}`} />
                            </div>
                        </div>
                    ))}

                    {/* Aggregates */}
                    <div className={`grid ${COLS} gap-x-4 items-center pt-3`} data-testid="qual-aggregates">
                        <div className="text-xs text-[#4A4A4A] leading-snug">
                            <div><strong>Media</strong> · calidad general</div>
                            <div><strong>Suma</strong> · potencial total</div>
                        </div>
                        <div className="flex justify-center">
                            <HoverTip text="Media de todos los 'Score global tesis': una idea de la calidad general de la empresa a través de las tesis en las que encaja." maxWidth={300}>
                                <div className="cursor-help"><ValueBox text={profile.avg_overall_score ?? "—"} color={scoreColor(profile.avg_overall_score)} testid="qual-avg-overall" /></div>
                            </HoverTip>
                        </div>
                        <div className="flex justify-center">
                            <HoverTip text="Suma de todos los TAM Scores: una idea del potencial total acumulado de la empresa por su exposición a varias tendencias." maxWidth={300}>
                                <div className="cursor-help"><ValueBox text={fmtTamScore(profile.sum_tam_score) ?? "—"} color={tamColor(profile.sum_tam_score)} testid="qual-sum-tam" /></div>
                            </HoverTip>
                        </div>
                    </div>
                </>
            )}

            {/* Reverse (company → trends) thesis link, if one exists */}
            {reverse && (
                <div className={`flex items-center justify-between gap-2 ${rows.length ? "mt-4 pt-3 border-t border-black/10" : ""}`}>
                    <span className="text-xs text-[#4A4A4A]">
                        Análisis temático de <strong>{ticker}</strong>{reverse.overall_relevance != null ? ` · relevancia ${reverse.overall_relevance}` : ""}
                    </span>
                    <Link to={`/thesis/${reverse.thesis_id}`} className="text-xs text-[#052049] hover:underline inline-flex items-center gap-1" data-testid="company-qual-reverse-link">
                        Ver tesis completa <ArrowRight size={12} />
                    </Link>
                </div>
            )}
        </div>
    );
}
